import json
import re
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import seo  # noqa: E402
from server import app  # noqa: E402

client = TestClient(app)
BASE = "https://synklab.qeva-ai.com"


def ldjson(html: str) -> dict:
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert m, "no JSON-LD found"
    return json.loads(m.group(1))


class PageTests(unittest.TestCase):
    def test_every_service_has_its_own_crawlable_page(self):
        for page in seo.PAGES:
            with self.subTest(path=page.path):
                r = client.get(page.path)
                self.assertEqual(r.status_code, 200)
                self.assertIn("text/html", r.headers["content-type"])
                html = r.text
                self.assertEqual(len(re.findall(r"<h1[ >]", html)), 1, "exactly one <h1> per page")
                self.assertIn(f"<title>{page.title}</title>".replace("&", "&amp;"), html)
                self.assertIn(f'<link rel="canonical" href="{BASE}{page.path}"/>', html)
                self.assertIn(f'<meta property="og:url" content="{BASE}{page.path}"/>', html)
                self.assertIn('<meta name="robots" content="index,follow', html)
                self.assertEqual(len(re.findall(r'<section class="view active"', html)), 1)
                self.assertIn(f'<section class="view active" id="view-{page.view}">', html)
                self.assertIn(f'window.__SEO_VIEW__="{page.view}"', html)

    def test_the_h1_belongs_to_the_active_view(self):
        for page in seo.PAGES:
            with self.subTest(path=page.path):
                html = client.get(page.path).text
                start = html.index(f'id="view-{page.view}"')
                h1 = html.index("<h1")
                self.assertGreater(h1, start)
                next_view = html.find('<section class="view', start + 10)
                self.assertTrue(next_view < 0 or h1 < next_view)

    def test_titles_and_descriptions_fit_a_search_result(self):
        for page in seo.PAGES:
            with self.subTest(path=page.path):
                self.assertLessEqual(len(page.title), 65)
                self.assertLessEqual(len(page.description), 165)
        self.assertEqual(len({p.title for p in seo.PAGES}), len(seo.PAGES), "titles must be unique")
        self.assertEqual(len({p.description for p in seo.PAGES}), len(seo.PAGES), "descriptions must be unique")

    def test_structured_data_is_valid_and_never_invents_ratings(self):
        for page in seo.PAGES:
            with self.subTest(path=page.path):
                data = ldjson(client.get(page.path).text)
                graph = {n["@type"]: n for n in data["@graph"]}
                app_node = graph["WebApplication"]
                self.assertEqual(app_node["offers"]["price"], "0")
                self.assertEqual(app_node["url"], BASE + page.path)
                self.assertNotIn("aggregateRating", app_node)
                self.assertNotIn("review", app_node)
                self.assertIn("Organization", graph)
                self.assertEqual("BreadcrumbList" in graph, page.path != "/")

    def test_home_is_still_the_auto_dj_app(self):
        html = client.get("/").text
        self.assertIn("AUTO DJ ONLINE", html)
        self.assertIn('<section class="view active" id="view-autodj">', html)
        self.assertIn('id="djStart"', html)  # the mixer controls the JS binds to are untouched
        self.assertIn('<nav class="seo-links"', html)

    def test_head_requests_are_answered(self):
        for path in ("/", "/sitemap.xml", "/robots.txt", "/sellos-techno"):
            with self.subTest(path=path):
                self.assertEqual(client.head(path).status_code, 200)

    def test_canonicals_always_point_at_production_even_when_served_locally(self):
        with mock.patch.dict("os.environ", {"SITE_URL": "https://example.test/"}):  # no such setting exists: it must be ignored
            self.assertIn(f'href="{BASE}/sellos-techno"', client.get("/sellos-techno").text)
            self.assertIn(f"<loc>{BASE}/</loc>", client.get("/sitemap.xml").text)


class SitemapAndRobotsTests(unittest.TestCase):
    def test_sitemap_lists_every_page_once(self):
        r = client.get("/sitemap.xml")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/xml", r.headers["content-type"])
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [e.text for e in ET.fromstring(r.text).findall("s:url/s:loc", ns)]
        self.assertEqual(sorted(locs), sorted(BASE + p.path for p in seo.PAGES))
        for e in ET.fromstring(r.text).findall("s:url/s:lastmod", ns):
            self.assertRegex(e.text, r"^\d{4}-\d{2}-\d{2}$")

    def test_robots_points_to_the_sitemap_and_keeps_apis_out(self):
        r = client.get("/robots.txt")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/plain", r.headers["content-type"])
        self.assertIn(f"Sitemap: {BASE}/sitemap.xml", r.text)
        self.assertIn("Disallow: /api/", r.text)
        self.assertIn("Allow: /", r.text)


class ErrorTests(unittest.TestCase):
    def test_browsers_get_an_html_404_that_is_not_indexed(self):
        r = client.get("/nope", headers={"accept": "text/html,application/xhtml+xml"})
        self.assertEqual(r.status_code, 404)
        self.assertIn("text/html", r.headers["content-type"])
        self.assertIn('<meta name="robots" content="noindex"/>', r.text)
        self.assertIn('href="/detector-bpm-tonalidad"', r.text)

    def test_api_clients_keep_the_json_errors(self):  # behaviour that existed before the HTML 404
        r = client.get("/nope", headers={"accept": "application/json"})
        self.assertEqual((r.status_code, r.json()), (404, {"detail": "Not Found"}))
        r = client.get("/api/does-not-exist", headers={"accept": "text/html"})
        self.assertEqual((r.status_code, r.json()), (404, {"detail": "Not Found"}))
        r = client.get("/api/youtube", params={"url": "https://example.com/aaaaaaaaaaaa"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("YouTube", r.json()["detail"])

    def test_existing_endpoints_are_unchanged(self):
        self.assertEqual(client.get("/health").json(), {"status": "ok"})
        self.assertIn("version", client.get("/version").json())
        self.assertEqual(client.get("/static/mixer.js").status_code, 200)


if __name__ == "__main__":
    unittest.main()
