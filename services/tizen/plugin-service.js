var pluginHttp = require("../plugin-http.cjs");
var port = Number(process.env.NUVIO_PLUGIN_SERVICE_PORT || 2711);
var candidates = [port, 11471];
var index = 0;

function start() {
  var server = pluginHttp.createPluginHttpServer({ port: candidates[index] });
  server.listen(candidates[index], "127.0.0.1", function () {
    console.log("[Nuvio PluginService] listening on 127.0.0.1:" + candidates[index]);
  });
  server.on("error", function (error) {
    if (error && error.code === "EADDRINUSE" && index < candidates.length - 1) {
      index += 1;
      try {
        server.close();
      } catch (_) {}
      start();
    } else {
      console.error("[Nuvio PluginService] failed to listen", error);
    }
  });
}

start();
