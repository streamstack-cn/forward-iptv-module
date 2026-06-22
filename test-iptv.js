const fs = require("fs");
const assert = require("assert/strict");

global.Widget = {
  http: {
    get: async (url) => {
      if (url.includes("m3u")) {
        return {
          data: `
#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="CCTV1" tvg-logo="logo.png" group-title="央视",CCTV-1 综合
http://stream.cctv1
#EXTINF:-1 tvg-id="2" tvg-name="CCTV2" tvg-logo="logo2.png" group-title="央视",CCTV-2 财经
http://stream.cctv2
          `.trim()
        };
      }
      if (url.includes("e.xml")) {
        return {
          data: `
          <programme start="20260622080000 +0800" stop="20260622100000 +0800" channel="1">
            <title>Morning News</title>
          </programme>
          <programme start="20260622100000 +0800" stop="20260622235959 +0800" channel="1">
            <title>Test Program CCTV1</title>
          </programme>
        `
        };
      }
      return { data: "" };
    }
  }
};
global.WidgetMetadata = {};

eval(fs.readFileSync("./iptv.js", "utf8"));

(async () => {
  const params = {
    m3uUrl: "http://test/m3u",
    epgUrl: "http://test/e.xml"
  };

  const list = await loadList(params);
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "CCTV-1 综合");
  assert.ok(list[0].link.indexOf("ch:") === 0);

  const detail = await loadDetail(list[0].link);
  assert.equal(detail.title, "CCTV-1 综合");
  assert.equal(detail.videoUrl, undefined);
  assert.equal(detail.episodeItems, undefined);
  assert.ok(detail.description.includes("📺"));
  assert.ok(detail.description.includes("即将播出") || detail.description.includes("正在播出"));
  assert.ok(Array.isArray(detail.relatedItems));

  const stream = await loadResource({ link: list[0].link });
  assert.equal(stream.length, 1);
  assert.equal(stream[0].url, "http://stream.cctv1");

  console.log("✅ test pass!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
