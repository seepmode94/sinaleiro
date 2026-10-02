/* The phone's way in: the QR code opens /#t=<token>; the token goes to the server once (it answers with a cookie), and
 * leaves the address bar and the history before the farm loads. The fragment never reaches the server's logs. */
"use strict";
const enter = async () => {
  const msg = document.getElementById("msg");
  const t = new URLSearchParams(location.hash.slice(1)).get("t");
  history.replaceState(null, "", "/");
  if (!t) {
    msg.innerHTML = "Para entrar, lê com o telemóvel o QR code que aparece no terminal do PC quando corres <code>sinaleiro serve --lan</code>.";
    return;
  }
  try {
    const r = await fetch("api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Sinaleiro": "1" }, body: JSON.stringify({ token: t }) });
    if (!r.ok) throw new Error(r.status);
    location.replace("/");
  } catch {
    msg.className = "err";
    msg.innerHTML = "Este link já não vale. No PC, corre <code>sinaleiro serve --lan</code> e lê o QR code novo.";
  }
};
enter();
window.addEventListener("hashchange", enter); // the link pasted into a tab already on this page
