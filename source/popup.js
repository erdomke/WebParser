import browser from 'webextension-polyfill';

async function onLoad() {
  let response
  try {
    response = JSON.stringify(await browser.runtime.sendMessage("start"));
  } catch (e) {
    response = JSON.stringify(e, Object.getOwnPropertyNames(e));
  }
  document.getElementById("message").textContent = response;
}

document.addEventListener("DOMContentLoaded", onLoad);