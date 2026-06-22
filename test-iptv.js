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
          `.trim()
        };
      }
      if (url.includes("e.xml")) {
        return {
          data: `
          <channel id="1"><display-name lang="zh">CCTV1</display-name></channel>
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
  const params = { m3uUrl: "http://test/m3u", epgUrl: "http://test/e.xml" };
  const list = await loadList(params);
  const link = list[0].link;

  const detail = await loadDetail(link);
  assert.equal(detail.videoUrl, undefined);
  assert.equal(detail.backdropPath, undefined);
  assert.equal(detail.posterPath, "logo.png");
  assert.equal(detail.episodeName, "节目单");
  assert.ok(detail.description.indexOf("节目单") >= 0);
  assert.ok(detail.genreTitle.length > 0);
  assert.ok(detail.description.indexOf("[ LIVE ]") >= 0 || detail.description.indexOf("暂无") >= 0);

  const stream = await loadResource({ link: link });
  assert.ok(stream[0].url.indexOf("http://stream.cctv1") === 0);
  assert.ok(stream[0].url.indexOf("_fwd=") > 0);

  console.log("✅ test pass!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
