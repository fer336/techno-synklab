#!/usr/bin/env python3
"""Generates the SYNK//LAB documentation diagrams (animated SVG for the README + one interactive HTML page).

Design grammar follows the diagram-design skill: editorial, flat (no shadows), hairline borders, orthogonal
connectors, 1-2 accent nodes per diagram, static-first (everything is visible without animation).
Usage (from the project root): python3 docs/tools/build_diagrams.py .
"""
import html
import json
import math
import os
import sys

OUT = sys.argv[1]
IMG = os.path.join(OUT, "docs", "img")
os.makedirs(IMG, exist_ok=True)

BG, CARD, INK = "#080b0b", "#0f1413", "#edf1e9"
MUTED, SOFT, LINE = "#a3aea6", "#7f8b84", "#3a4640"
ACC, LINK = "#caff1a", "#8ab4e8"
SANS = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
MONO = "ui-monospace,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace"


def esc(s):
    return html.escape(str(s), quote=True)


def tw(text, size, mono=False, bold=False):
    """Pessimistic text width estimate for system fonts."""
    k = 0.62 if mono else (0.60 if bold else 0.56)
    return len(text) * size * k


# ----------------------------------------------------------------------------------------- primitives
def node(id, x, y, w, h, name, subs=(), kind="", edges=""):
    need = max([tw(name, 13, False, True)] + [tw(s, 10, True) for s in subs]) + 24
    assert need <= w, f"node {id}: needs {need:.0f}px, has {w}"
    assert 28 + 15 * len(subs) <= h + 4, f"node {id}: height {h} too small for {len(subs)} sublabels"
    g = [f'<g class="n {kind}" data-id="{id}" data-edges="{edges}" tabindex="0" role="button" aria-label="{esc(name)}">',
         f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6"/>',
         f'<text class="nn" x="{x + 12}" y="{y + 22}">{esc(name)}</text>']
    for i, s in enumerate(subs):
        g.append(f'<text class="ns" x="{x + 12}" y="{y + 40 + i * 15}">{esc(s)}</text>')
    g.append("</g>")
    return "".join(g)


def edge(id, d, cls="", label=None, lx=0, ly=0):
    out = f'<path id="{id}" class="e {cls}" d="{d}" marker-end="url(#ah)"/>'
    if label:
        w = tw(label, 9, True) + 10
        out += (f'<g class="al-g" data-edge="{id}"><rect class="alm" x="{lx - w / 2:.1f}" y="{ly - 8}" width="{w:.1f}" height="14" rx="2"/>'
                f'<text class="al" x="{lx}" y="{ly + 3}" text-anchor="middle">{esc(label)}</text></g>')
    return out


def zone(x, y, w, h, label):
    lw = tw(label, 8.5, True) + 12
    return (f'<rect class="zone" x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/>'
            f'<rect class="alm" x="{x + 12}" y="{y - 7}" width="{lw:.0f}" height="14" rx="2"/>'
            f'<text class="zl" x="{x + 18}" y="{y + 3}">{esc(label)}</text>')


def hvh(x1, y1, x2, y2, xm, r=8):
    """Orthogonal connector: horizontal to xm, vertical to y2, horizontal to x2 (rounded corners)."""
    sy = 1 if y2 > y1 else -1
    return (f"M{x1},{y1} H{xm - r} Q{xm},{y1} {xm},{y1 + sy * r} V{y2 - sy * r} Q{xm},{y2} {xm + r},{y2} H{x2}")


def vhv(x1, y1, x2, y2, ym, r=8):
    """Orthogonal connector: vertical to ym, horizontal to x2, vertical to y2."""
    sx = 1 if x2 > x1 else -1
    sy = 1 if y2 > y1 else -1
    return (f"M{x1},{y1} V{ym - sy * r} Q{x1},{ym} {x1 + sx * r},{ym} H{x2 - sx * r} Q{x2},{ym} {x2},{ym + sy * r} V{y2}")


def token(path_id, dur=4.2, begin=0):
    return (f'<circle class="tok" r="3.6" fill="{ACC}"><animateMotion dur="{dur}s" begin="{begin}s" repeatCount="indefinite" '
            f'calcMode="linear"><mpath href="#{path_id}"/></animateMotion></circle>')


BASE_CSS = f"""
.bg{{fill:{BG}}}
.zone{{fill:rgba(237,241,233,.02);stroke:rgba(237,241,233,.11);stroke-width:.8}}
.zl{{font:500 8.5px {MONO};letter-spacing:.14em;fill:{SOFT}}}
.n rect{{fill:{CARD};stroke:{LINE};stroke-width:1}}
.n.focal rect{{fill:rgba(202,255,26,.08);stroke:{ACC};stroke-width:1.4}}
.n.ext rect,.n.opt rect{{stroke-dasharray:4 3}}
.n{{cursor:default}}
.div{{stroke:rgba(237,241,233,.10);stroke-width:1}}
.nn{{font:600 13px {SANS};fill:{INK}}}
.ns{{font:400 10px {MONO};fill:{MUTED}}}
.e{{fill:none;stroke:{SOFT};stroke-width:1.2}}
.e.link{{stroke:{LINK}}}
.e.dash{{stroke-dasharray:4 3;stroke-width:1}}
.alm{{fill:{BG}}}
.al{{font:400 9px {MONO};letter-spacing:.04em;fill:{MUTED}}}
.eb{{font:500 8.5px {MONO};letter-spacing:.16em;fill:{SOFT}}}
.tit{{font:400 22px Georgia,'Times New Roman',serif;fill:{INK}}}
.sub{{font:400 11px {MONO};fill:{MUTED}}}
.note{{font:italic 400 13px Georgia,'Times New Roman',serif;fill:{MUTED}}}
@media (prefers-reduced-motion:reduce){{.tok{{display:none}}}}
"""


def svg(inner, w, h, title, desc, extra_css="", defs_id="p"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="{defs_id}t {defs_id}d" font-family="{SANS}">'
            f'<title id="{defs_id}t">{esc(title)}</title><desc id="{defs_id}d">{esc(desc)}</desc>'
            f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M1,1 L9,5 L1,9" fill="none" stroke="context-stroke" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>'
            f'<style>{BASE_CSS}{extra_css}</style></defs>'
            f'<rect class="bg" width="{w}" height="{h}"/>{inner}</svg>')


def header(title, sub, eyebrow):
    return (f'<text class="eb" x="32" y="34">{esc(eyebrow)}</text>'
            f'<text class="tit" x="32" y="62">{esc(title)}</text>'
            f'<text class="sub" x="32" y="82">{esc(sub)}</text>')


# ----------------------------------------------------------------------------------------- 1. architecture
INFO = {
    "arch": {
        "browser": ("Navegador · la app SYNK//LAB", "static/index.html · static/mixer.js",
                    "Aquí vive todo el audio: dos decks de Web Audio, EQ, filtros, efectos, crossfader, beatgrid y las transiciones automáticas. "
                    "Tus archivos se procesan en el navegador y no se suben a ningún lado. Es la única pieza que suena."),
        "agent": ("Agente DJ (opcional)", "dj_agent.py",
                  "Escucha los eventos del mixer y, poco antes de que termine un tema, decide cómo mezclar el siguiente: duración del fade, EQ, efecto y filtro. "
                  "Corre en tu máquina y no necesita claves de API."),
        "cli": ("CLI de IA", "claude -p  ·  codex exec",
                "El agente le pregunta a la CLI donde ya iniciaste sesión (suscripción de Claude o de ChatGPT) y recibe un JSON corto. "
                "Si la IA tarda demasiado, el agente usa reglas aleatorias como respaldo."),
        "server": ("Servidor FastAPI", "server.py · agent_bridge.py · netguard.py",
                   "Sirve la app, consulta MusicBrainz (máx. 1 consulta/s, caché de 6 h) y hace de puente entre el agente y la pestaña: guarda una cola de comandos y un buffer de eventos. "
                   "Los endpoints del agente y de descarga solo aceptan clientes locales."),
        "dl": ("Descargas (opcional)", "downloader.py · yt-dlp + ffmpeg",
               "Solo si lo pides por enlace (YouTube o SoundCloud, únicamente HTTPS): baja el audio como MP3 320k a tu carpeta Inbox y lo importa al mixer. "
               "Sin tu orden no descarga nada. Úsalo solo con contenido que tengas derecho a usar."),
        "mb": ("MusicBrainz", "catálogo de metadatos",
               "Búsqueda por texto de temas, sellos y lanzamientos. Son metadatos: no hay búsqueda por similitud de sonido."),
        "yt": ("YouTube · SoundCloud", "enlaces de referencia",
               "Fuente de enlaces para previsualizar y, si quieres, descargar. El audio embebido solo se mezcla por volumen: no se puede enrutar a Web Audio."),
    }
}


def arch_svg(mode="img"):
    s = header("Cómo está armado", "Tres piezas locales: la pestaña que suena, el servidor que la acompaña y un agente opcional.", "ARQUITECTURA")
    s += zone(24, 112, 330, 452, "TU EQUIPO")
    s += zone(420, 112, 290, 452, "CONTENEDOR DOCKER")
    # edges first (z-order)
    s += edge("a-ui", "M330,184 H444", "link", "UI + catálogo", 387, 184)
    s += edge("a-poll", "M330,220 H444", "link dash", "poll · eventos", 387, 220)
    s += edge("a-cmd", "M330,307 H444", "link", "command · events", 387, 307)
    s += edge("a-cli", "M189,339 V460", "", "prompt → JSON", 189, 400)
    s += edge("a-dl", "M565,410 V460", "dash", "opt-in por enlace", 565, 435)
    s += edge("a-mb", "M686,196 H770", "", "metadatos", 728, 196)
    s += edge("a-yt", "M686,492 H770", "dash", "descarga", 728, 492)
    s += node("browser", 48, 160, 282, 84, "Navegador", ["SYNK//LAB · Web Audio", "decks · EQ · FX · mezcla"], "focal", "a-ui,a-poll")
    s += node("agent", 48, 275, 282, 64, "Agente DJ", ["dj_agent.py · decide cada mezcla"], "focal", "a-cmd,a-cli")
    s += node("cli", 48, 460, 282, 64, "CLI de IA", ["claude -p  ·  codex exec"], "ext", "a-cli")
    s += ('<g class="n" data-id="server" data-edges="a-ui,a-poll,a-cmd,a-dl,a-mb" tabindex="0" role="button" aria-label="Servidor FastAPI">'
          '<rect x="444" y="160" width="242" height="250" rx="6"/>'
          '<text class="nn" x="456" y="182">Servidor FastAPI</text>'
          '<text class="ns" x="456" y="200">server.py · :8000</text><text class="ns" x="456" y="215">sirve la app · MusicBrainz</text>'
          '<line class="div" x1="444" y1="262" x2="686" y2="262"/>'
          '<text class="ns" x="456" y="292">agent_bridge.py</text><text class="ns" x="456" y="307">cola de comandos</text><text class="ns" x="456" y="322">y buffer de eventos</text>'
          '<line class="div" x1="444" y1="374" x2="686" y2="374"/>'
          '<text class="ns" x="456" y="396">netguard.py · solo local</text></g>')
    s += node("dl", 444, 460, 242, 64, "Descargas", ["yt-dlp + ffmpeg → Inbox"], "opt", "a-dl,a-yt")
    s += node("mb", 770, 168, 206, 56, "MusicBrainz", ["catálogo"], "ext", "a-mb")
    s += node("yt", 770, 464, 206, 56, "YouTube · SoundCloud", ["enlaces"], "ext", "a-yt")
    if mode == "img":
        s += token("a-cmd", 3.6)
    return svg(s, 1000, 590, "Arquitectura de SYNK//LAB",
               "El navegador reproduce y mezcla; el servidor FastAPI sirve la app y hace de puente; el agente DJ opcional decide cada transición consultando a una CLI de IA.", "ar")


# ----------------------------------------------------------------------------------------- 2. agent sequence
SEQ = [
    (1, "Falta poco: la pestaña avisa <code>track_ending</code> unos 70 s antes del punto de salida."),
    (2, "El agente espera en <em>long-poll</em> y recibe el evento."),
    (3, "El agente pide el estado: decks, cola y datos del tema siguiente. El servidor retransmite el comando y la pestaña responde."),
    (4, "Arma un prompt con la pareja de temas: diferencia de BPM, compatibilidad de tonalidad (Camelot), peso del bajo y si los golpes se pueden alinear."),
    (5, "La IA contesta solo un JSON: <code>fade</code>, <code>eq</code>, <code>fx</code>, <code>fx_amount</code>, <code>filter</code> y, si quiere, <code>next_id</code>."),
    (6, "El agente envía <code>plan_transition</code> con <code>from_id</code>. Si la mezcla ya empezó, el mixer rechaza el plan por tardío."),
    (7, "El mixer ejecuta la mezcla alineada por beatgrid y avisa <code>transition_start</code>."),
]


def seq_svg(mode="img"):
    NAV, SRV, AGT, IA = 130, 370, 630, 880
    s = header("Cómo decide el agente cada mezcla", "Siete mensajes entre la pestaña, el servidor, el agente y la IA.", "FLUJO DEL AGENTE")
    heads = [("nav", NAV, "Navegador", "mixer", "focal"), ("srv", SRV, "Servidor", "puente /api/agent", ""),
             ("agt", AGT, "Agente DJ", "dj_agent.py", "focal"), ("ia", IA, "IA", "claude · codex", "ext")]
    for hid, cx, name, sub, kind in heads:
        s += f'<line class="life" x1="{cx}" y1="148" x2="{cx}" y2="640"/>'
    for hid, cx, name, sub, kind in heads:
        s += node("s-" + hid, cx - 85, 100, 170, 48, name, [], kind) if False else ""
        w = 170
        s += (f'<g class="n {kind}" data-id="s-{hid}"><rect x="{cx - w // 2}" y="100" width="{w}" height="48" rx="6"/>'
              f'<text class="nn" x="{cx - w // 2 + 12}" y="122">{esc(name)}</text><text class="ns" x="{cx - w // 2 + 12}" y="138">{esc(sub)}</text></g>')

    def msg(step, y, x1, x2, label, cls="", lx=None):
        d = f"M{x1},{y} H{x2}"
        w = tw(label, 9, True) + 10
        cx = lx if lx is not None else (x1 + x2) / 2
        return (f'<g class="msg" data-step="{step}">'
                f'<path class="e {cls}" d="{d}" marker-end="url(#ah)"/>'
                f'<rect class="alm" x="{cx - w / 2:.1f}" y="{y - 20}" width="{w:.1f}" height="14" rx="2"/>'
                f'<text class="al" x="{cx}" y="{y - 9}" text-anchor="middle">{esc(label)}</text>'
                f'<circle class="stepdot" cx="{min(x1, x2) - 0}" cy="{y}" r="0"/></g>')

    s += msg(1, 196, NAV + 4, SRV - 4, "POST /event · track_ending", "link")
    s += msg(2, 252, SRV + 4, AGT - 4, "long-poll → track_ending", "link dash")
    s += msg(3, 312, AGT - 4, NAV + 4, "command: state  (vía /poll)", "link", lx=500)
    s += msg(3, 340, NAV + 4, AGT - 4, "estado: decks · cola", "link dash", lx=500)
    s += msg(4, 410, AGT + 4, IA - 4, "prompt: BPM · tonalidad · bajo", "")
    s += msg(5, 462, IA - 4, AGT + 4, "JSON: fade · eq · fx · filtro", "dash")
    s += msg(6, 530, AGT - 4, NAV + 4, "plan_transition(from_id)", "link", lx=500)
    s += msg(7, 590, NAV + 4, SRV - 4, "POST /event · transition_start", "link")
    # step badges
    badges = [(1, 196, NAV - 26), (2, 252, SRV - 26), (3, 312, AGT + 26), (4, 410, AGT - 26), (5, 462, IA + 26), (6, 530, AGT + 26), (7, 590, NAV - 26)]
    for st, y, x in badges:
        s += (f'<g class="msg" data-step="{st}"><circle cx="{x}" cy="{y}" r="9" class="badge"/>'
              f'<text class="bt" x="{x}" y="{y + 3.5}" text-anchor="middle">{st}</text></g>')
    css = f""".life{{stroke:{LINE};stroke-width:1;stroke-dasharray:3 4}}
.badge{{fill:{BG};stroke:{ACC};stroke-width:1.2}}
.bt{{font:600 10px {MONO};fill:{ACC}}}"""
    if mode == "img":
        total = 16.0
        starts = [0.6, 2.4, 4.2, 6.6, 8.4, 10.4, 12.4]
        for i, st in enumerate(starts, 1):
            a = st / total * 100
            css += (f"@keyframes m{i}{{0%,{a:.2f}%{{opacity:0}}{a + 1.8:.2f}%,90%{{opacity:1}}98%,100%{{opacity:0}}}}"
                    f'.msg[data-step="{i}"]{{animation:m{i} {total}s linear infinite}}')
        css += "@media (prefers-reduced-motion:reduce){.msg{animation:none!important;opacity:1!important}}"
    return svg(s, 1000, 660, "Flujo del agente DJ",
               "Secuencia: el navegador avisa que un tema termina; el agente lee el estado, consulta a la IA, envía el plan de transición y el mixer la ejecuta.", css, "sq")


# ----------------------------------------------------------------------------------------- 3. phrase mixing
A_DB = [-10.4, -8.9, -8.9, -11.4, -9.6, -8.9, -9, -9.2, -9.1, -8.8, -9.1, -8.7, -8.7, -8.3, -8.3, -8.3, -10.3, -14.7, -16.2, -18.7, -12.2, -8.9, -9, -8.9, -8.9, -8.8, -9, -8.6, -8.7, -10, -10.8]
B_DB = [-14.2, -13.7, -6.1, -6.1, -6.2, -7.2, -6.3, -6.3, -6.3, -6.5, -12.1, -13.7, -6.5, -6.4, -6.6, -12, -6.4, -6.6, -6.4, -9.4, -6.5, -6.6, -6.6, -6.8, -18.6, -20.5, -20.6, -18, -17.1, -15.4, -13.2, -13, -6.4, -6.5, -6.6, -11.3]
PX = 3.6          # px per second
X0 = 60           # x of second 0 of track A
PH_A, PH_B = 7.5, 7.385   # seconds per 16-beat phrase
FADE = 16
EXIT_PHRASE, EXIT_END = 120.3, 236.0
ENTRY_B = 15.0
LANE_A, LANE_B = 196, 316     # baseline y of each lane (bars grow upward)


def bars(db, ph, x_origin, base, cls, maxn=None, clip=(40, 940)):
    out = []
    for i, v in enumerate(db[: maxn or len(db)]):
        h = max(5, min(56, (v + 22) * 3.4))
        x = x_origin + i * ph * PX
        w = ph * PX - 2
        if x + w < clip[0] or x > clip[1]:
            continue
        out.append(f'<rect class="{cls}" data-i="{i}" x="{x:.1f}" y="{base - h:.1f}" width="{w:.1f}" height="{h:.1f}" rx="1.5"/>')
    return "".join(out)


def mix_geom(phrase=True):
    exit_t = EXIT_PHRASE if phrase else EXIT_END
    win_x0 = X0 + (exit_t - FADE) * PX
    win_x1 = X0 + exit_t * PX
    b_origin = win_x0 - (ENTRY_B * PX if phrase else 0)
    return win_x0, win_x1, b_origin


def mix_svg(mode="img"):
    win_x0, win_x1, b_origin = mix_geom(True)
    s = header("Mezcla por frases", "Se ve la energía de cada frase de 16 beats (energía real medida en dos temas de prueba).", "ENERGÍA POR FRASE")
    s += f'<g id="mx-lanes">'
    s += f'<text class="eb" x="{X0}" y="{LANE_A - 66}">DECK A · TEMA SALIENTE · 128 BPM</text>'
    s += f'<text class="eb" x="{X0}" y="{LANE_B - 66}">DECK B · TEMA ENTRANTE · 129.8 BPM</text>'
    s += f'<line class="axis" x1="{X0}" y1="{LANE_A}" x2="940" y2="{LANE_A}"/><line class="axis" x1="{X0}" y1="{LANE_B}" x2="940" y2="{LANE_B}"/>'
    s += f'<g id="mx-A">{bars(A_DB, PH_A, X0, LANE_A, "bA")}</g>'
    s += f'<clipPath id="mxclip"><rect x="40" y="{LANE_B - 70}" width="900" height="90"/></clipPath>'
    s += f'<g clip-path="url(#mxclip)"><g id="mx-B" transform="translate({b_origin - X0:.1f},0)">{bars(B_DB, PH_B, X0, LANE_B, "bB", clip=(-10000, 10000))}</g></g>'
    s += "</g>"
    # intro skipped: dim first 2 phrases of B
    s += (f'<rect id="mx-skip" class="skip" x="{b_origin:.1f}" y="{LANE_B - 60}" width="{ENTRY_B * PX:.1f}" height="64"/>')
    s += (f'<rect id="mx-win" class="win" x="{win_x0:.1f}" y="{LANE_A - 74}" width="{win_x1 - win_x0:.1f}" height="{LANE_B - LANE_A + 82}" rx="4"/>')
    s += (f'<line id="mx-ph" class="playhead" x1="{win_x0:.1f}" y1="{LANE_A - 80}" x2="{win_x0:.1f}" y2="{LANE_B + 10}"/>')
    # annotations
    s += (f'<g id="mx-ann-phrase"><text class="eb ann" x="{win_x1 + 8:.1f}" y="{LANE_A - 60}">SALIDA · LA ENERGÍA CAE</text>'
          f'<text class="eb ann" x="{b_origin + 4:.1f}" y="{LANE_B + 22}">INTRO SALTEADO · {ENTRY_B:.0f} s</text></g>')
    # bottom panel: crossfade curve (equal power) and tempo
    cy0, ch = 372, 96
    pts_a, pts_b = [], []
    for k in range(0, 41):
        t = k / 40
        x = 60 + t * 380
        pts_a.append(f"{x:.1f},{cy0 + ch - math.cos(t * math.pi / 2) * ch:.1f}")
        pts_b.append(f"{x:.1f},{cy0 + ch - math.sin(t * math.pi / 2) * ch:.1f}")
    s += f'<text class="eb" x="60" y="{cy0 - 12}">CROSSFADE · POTENCIA CONSTANTE (COS / SEN)</text>'
    s += f'<rect class="panel" x="60" y="{cy0}" width="380" height="{ch}" rx="4"/>'
    s += f'<polyline class="cA" points="{" ".join(pts_a)}"/><polyline class="cB" points="{" ".join(pts_b)}"/>'
    s += f'<line id="mx-cph" class="playhead" x1="60" y1="{cy0}" x2="60" y2="{cy0 + ch}"/>'
    s += f'<text class="al cAt" x="68" y="{cy0 + 14}">A</text><text class="al cBt" x="426" y="{cy0 + 14}">B</text>'
    s += f'<text class="al" x="60" y="{cy0 + ch + 16}">0 %</text><text class="al" x="440" y="{cy0 + ch + 16}" text-anchor="end">100 %</text>'
    s += f'<text class="eb" x="500" y="{cy0 - 12}">TEMPO · SE ENCUENTRAN EN EL PROMEDIO</text>'
    s += node("m-tA", 500, cy0, 130, 56, "128.0", ["deck A"], "")
    s += node("m-tB", 810, cy0, 130, 56, "129.8", ["deck B"], "")
    s += node("m-tM", 655, cy0 + 8, 130, 48, "128.9", ["ambos al promedio"], "focal")
    s += f'<path class="e" d="M630,{cy0 + 28} H655" marker-end="url(#ah)"/><path class="e" d="M810,{cy0 + 28} H785" marker-end="url(#ah)"/>'
    s += (f'<text class="note" x="500" y="{cy0 + 92}">Entra en su primera frase con bajo y nivel parecido,</text>'
          f'<text class="note" x="500" y="{cy0 + 112}">y el que sale se funde donde la energía cae.</text>')
    css = f""".axis{{stroke:{LINE};stroke-width:1}}
.bA{{fill:{MUTED};opacity:.85}} .bB{{fill:{SOFT};opacity:.9}}
.win{{fill:rgba(202,255,26,.07);stroke:{ACC};stroke-width:1;stroke-dasharray:4 3}}
.skip{{fill:{BG};opacity:.62}}
.playhead{{stroke:{ACC};stroke-width:1.6}}
.ann{{fill:{ACC}}}
.panel{{fill:{CARD};stroke:{LINE};stroke-width:1}}
.cA{{fill:none;stroke:{MUTED};stroke-width:1.8}} .cB{{fill:none;stroke:{ACC};stroke-width:1.8}}
.cAt{{fill:{MUTED}}} .cBt{{fill:{ACC}}}"""
    if mode == "img":
        d = 6.0
        s += (f'<animate xlink:href="#mx-ph" attributeName="x1" from="{win_x0:.1f}" to="{win_x1:.1f}" dur="{d}s" repeatCount="indefinite"/>'
              .replace("xlink:href", "href"))
        s += f'<animate href="#mx-ph" attributeName="x2" from="{win_x0:.1f}" to="{win_x1:.1f}" dur="{d}s" repeatCount="indefinite"/>'
        s += f'<animate href="#mx-cph" attributeName="x1" from="60" to="440" dur="{d}s" repeatCount="indefinite"/>'
        s += f'<animate href="#mx-cph" attributeName="x2" from="60" to="440" dur="{d}s" repeatCount="indefinite"/>'
        css += "@media (prefers-reduced-motion:reduce){.playhead{display:none}}"
    return svg(s, 1000, 520, "Mezcla por frases",
               "El tema entrante salta su intro y entra en una frase con bajo y energía similar; el saliente se funde cuando su energía cae; ambos se encuentran en el tempo promedio.", css, "mx")


# ----------------------------------------------------------------------------------------- 4. audio chain
INFO["audio"] = {
    "file": ("Archivo local", "<audio> → MediaElementSource",
             "El archivo se reproduce con un elemento de audio del navegador y entra al grafo de Web Audio. Nada sale de tu equipo."),
    "eq": ("Filtros y EQ", "HP · LP · Low · Mid · High",
           "Pasa-altos (20 Hz) y pasa-bajos (19 kHz) para los barridos, y un EQ de 3 bandas: graves 180 Hz, medios 1.1 kHz, agudos 5.5 kHz. El Auto DJ los mueve solo durante la mezcla."),
    "fader": ("Fader del deck", "gain · crossfader",
              "El crossfader es de potencia constante: el deck A recibe cos θ y el B sen θ, así la suma se mantiene pareja durante el cruce."),
    "fx": ("Efectos post-fader", "eco · reverb · flanger",
           "Se envían después del fader, así sus colas sobreviven al crossfade. Eco: retardo de 320 ms con realimentación. Reverb: convolución. Flanger: retardo corto modulado por un LFO de 0.22 Hz."),
    "trim": ("Trim · auto-gain", "iguala volúmenes",
             "Compensa la diferencia de volumen entre temas usando el nivel RMS medido al analizar cada archivo."),
    "master": ("Master", "ganancia 0.82",
               "Suma ambos decks. Un analizador mide el nivel que ves en el medidor principal."),
    "comp": ("Compresor", "umbral −4 dB · ratio 16:1",
             "Limita los picos para proteger la salida cuando se suman dos temas fuertes."),
    "spk": ("Altavoces", "salida del navegador", "La mezcla que escuchas."),
    "rec": ("Grabación del set", "MediaStream", "Una copia de la salida final para grabar la sesión completa desde el navegador."),
}


def audio_svg(mode="img"):
    s = header("De archivo a altavoces", "La cadena de audio de cada deck y la salida común.", "CADENA DE AUDIO")
    s += zone(16, 124, 968, 150, "CADA DECK · A Y B TIENEN SU PROPIA COPIA")
    s += zone(16, 338, 968, 160, "SALIDA COMÚN")
    s += edge("c1", "M254,200 H294", "", None)
    s += edge("c2", "M526,200 H566", "", None)
    s += edge("c3", "M726,200 H766", "", None)
    s += edge("c4", vhv(889, 244, 127, 392, 306), "dash", "los efectos se suman después del fader", 508, 306)
    s += edge("c5", "M254,423 H294", "", None)
    s += edge("c6", "M466,423 H506", "", None)
    s += edge("c7", hvh(736, 413, 776, 398, 756), "", None)
    s += edge("c8", hvh(736, 433, 776, 468, 756), "", None)
    s += node("file", 32, 160, 222, 84, "Archivo local", ["MP3 · WAV · FLAC", "<audio> del navegador"], "focal", "c1")
    s += node("eq", 294, 160, 232, 84, "Filtros y EQ", ["HP 20 Hz · LP 19 kHz", "Low 180 · Mid 1.1k · High 5.5k"], "", "c1,c2")
    s += node("fader", 566, 160, 160, 84, "Fader del deck", ["gain por deck", "crossfader A ↔ B"], "", "c2,c3")
    s += node("fx", 766, 160, 202, 84, "Efectos", ["eco · reverb · flanger", "post-fader"], "opt", "c3,c4")
    s += node("trim", 32, 392, 222, 62, "Trim · auto-gain", ["iguala los volúmenes"], "", "c4,c5")
    s += node("master", 294, 392, 172, 62, "Master", ["ganancia 0.82"], "", "c5,c6")
    s += node("comp", 506, 392, 230, 62, "Compresor", ["umbral −4 dB · 16:1"], "focal", "c6,c7,c8")
    s += node("spk", 776, 378, 192, 40, "Altavoces", [], "", "c7")
    s += node("rec", 776, 448, 192, 40, "Grabación del set", [], "opt", "c8")
    if mode == "img":
        s += f'<path id="flow" d="M40,202 H845 V306 H127 V423 H760" fill="none" stroke="none"/>' + token("flow", 7.5)
    return svg(s, 1000, 530, "Cadena de audio",
               "Archivo, filtros y EQ, fader, efectos post-fader, trim, master, compresor y salida a altavoces y grabación.", "", "au")


# ----------------------------------------------------------------------------------------- 5. hero
def hero_svg():
    import random
    rnd = random.Random(7)
    W, H = 1200, 340
    s = (f'<text class="eb" x="64" y="76">MEZCLADOR AUTO DJ PARA TECHNO · EN TU NAVEGADOR</text>'
         f'<text x="62" y="158" font-family="\'Arial Narrow\',\'Helvetica Neue\',Helvetica,Arial,sans-serif" font-size="92" font-weight="900" fill="{INK}" textLength="430" lengthAdjust="spacingAndGlyphs">SYNK<tspan fill="{ACC}">//</tspan>LAB</text>'
         f'<text class="sub" x="66" y="196" font-size="14">Dos decks, transiciones automáticas por frases y un agente de IA opcional que decide cada mezcla.</text>')
    chips = ["Web Audio", "Beatgrid", "EQ · filtros · FX", "Agente IA", "Docker"]
    cx = 66
    for c in chips:
        w = tw(c, 11, True) + 22
        s += (f'<rect x="{cx}" y="224" width="{w:.0f}" height="26" rx="5" fill="none" stroke="{LINE}"/>'
              f'<text class="ns" x="{cx + 11}" y="241" font-size="11">{esc(c)}</text>')
        cx += w + 10
    # two waveforms that crossfade
    n = 43
    base = 214
    css = ""
    bars_a, bars_b = [], []
    x0 = 770
    for i in range(n):
        env = 0.5 + 0.5 * math.sin(i / n * math.pi)
        ha = (22 + rnd.random() * 78) * (0.55 + 0.45 * env)
        hb = (22 + rnd.random() * 78) * (0.55 + 0.45 * (1 - env))
        x = x0 + i * 9.6
        bars_a.append(f'<rect class="wa" x="{x:.1f}" y="{base - ha / 2:.1f}" width="5" height="{ha:.1f}" rx="2" style="animation-delay:-{rnd.random() * 2.4:.2f}s"/>')
        bars_b.append(f'<rect class="wb" x="{x:.1f}" y="{base - hb / 2:.1f}" width="5" height="{hb:.1f}" rx="2" style="animation-delay:-{rnd.random() * 2.4:.2f}s"/>')
    s += f'<g class="gA">{"".join(bars_a)}</g><g class="gB">{"".join(bars_b)}</g>'
    s += f'<text class="eb" x="{x0}" y="76">A  ⟶  B</text>'
    css = f""".wa{{fill:{MUTED};transform-box:fill-box;transform-origin:center;animation:pulse 2.4s ease-in-out infinite}}
.wb{{fill:{ACC};transform-box:fill-box;transform-origin:center;animation:pulse 2.4s ease-in-out infinite}}
.gA{{animation:fadeA 8s ease-in-out infinite}} .gB{{animation:fadeB 8s ease-in-out infinite}}
@keyframes pulse{{0%,100%{{transform:scaleY(.55)}}50%{{transform:scaleY(1)}}}}
@keyframes fadeA{{0%,10%{{opacity:1}}50%,60%{{opacity:.08}}100%{{opacity:1}}}}
@keyframes fadeB{{0%,10%{{opacity:.08}}50%,60%{{opacity:1}}100%{{opacity:.08}}}}
@media (prefers-reduced-motion:reduce){{.wa,.wb,.gA,.gB{{animation:none!important}}.gA{{opacity:.55}}.gB{{opacity:.55}}}}"""
    return svg(s, W, H, "SYNK//LAB", "Mezclador Auto DJ para techno en el navegador: dos decks, mezcla por frases y agente de IA opcional.", css, "hr")


# ----------------------------------------------------------------------------------------- write SVG files
files = {"hero.svg": hero_svg(), "arquitectura.svg": arch_svg("img"), "agente.svg": seq_svg("img"),
         "mezcla.svg": mix_svg("img"), "audio.svg": audio_svg("img")}
for name, content in files.items():
    with open(os.path.join(IMG, name), "w", encoding="utf-8") as f:
        f.write(content)
    print("wrote", name, len(content) // 1024, "KB")

# ----------------------------------------------------------------------------------------- interactive page
TEMPLATE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "page_template.html"), encoding="utf-8").read()
page = (TEMPLATE
        .replace("%%ARCH%%", arch_svg("html")).replace("%%SEQ%%", seq_svg("html"))
        .replace("%%MIX%%", mix_svg("html")).replace("%%AUDIO%%", audio_svg("html"))
        .replace("%%INFO%%", json.dumps(INFO, ensure_ascii=False))
        .replace("%%SEQSTEPS%%", json.dumps(SEQ, ensure_ascii=False))
        .replace("%%GEOM%%", json.dumps({"px": PX, "x0": X0, "fade": FADE, "exitPhrase": EXIT_PHRASE, "exitEnd": EXIT_END, "entryB": ENTRY_B,
                                         "laneA": LANE_A, "laneB": LANE_B, "bpmA": 128.0, "bpmB": 129.8})))
with open(os.path.join(OUT, "docs", "arquitectura.html"), "w", encoding="utf-8") as f:
    f.write(page)
print("wrote arquitectura.html", len(page) // 1024, "KB")
