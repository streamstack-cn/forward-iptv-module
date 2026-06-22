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

  const detail = await loadDetail(list[0].link);
  assert.equal(detail.videoUrl, "http://stream.cctv1");
  assert.equal(detail.episodeItems, undefined);

  const descLines = detail.description.split("\n");
  assert.equal(descLines[1], "节目单");
  assert.ok(descLines[0].length > 0);
  assert.ok(detail.description.includes("[ LIVE ]"));
  assert.ok(!detail.description.includes("📺"));

  const detail2 = await loadDetail(list[0].link);
  assert.equal(detail2.videoUrl, "http://stream.cctv1");

  console.log("✅ test pass!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
