(() => {
  const TARGET = "/youtubei/v1/yta_web/join?alt=json";

  // fetch hook
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await origFetch(...args);

    try {
      const url = (typeof args[0] === "string") ? args[0] : args[0]?.url || "";
      if (url.includes(TARGET)) {
        const text = await res.clone().text();

        window.postMessage(
          { type: "YTA_JOIN_CAPTURED", url, body: text },
          "*"
        );
      }
    } catch (e) {
    }

    return res;
  };

  // XHR hook
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let url = "";

    const origOpen = xhr.open;
    xhr.open = function(method, u, ...rest) {
      url = u;
      return origOpen.call(this, method, u, ...rest);
    };

    xhr.addEventListener("loadend", () => {
      try {
        if (url && String(url).includes(TARGET) && xhr.responseType === "" /* text */) {
          window.postMessage(
            { type: "YTA_JOIN_CAPTURED", url, body: xhr.responseText },
            "*"
          );
        }
      } catch (e) {}
    });

    return xhr;
  }
  window.XMLHttpRequest = PatchedXHR;
})();
