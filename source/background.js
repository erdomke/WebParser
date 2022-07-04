// eslint-disable-next-line import/no-unassigned-import
import './options-storage.js';
import browser from 'webextension-polyfill';

/**
 * @param {Record<string, any>} object 
 * @param {string[]} path 
 */
const ensurePath = (object, path) => {
  let curr = object;
  for (let i = 0; i < path.length; i++) {
    let next = curr[path[i]] ?? {};
    curr[path[i]] = next;
    curr = next;
  }
}

/**
 * @param {Record<string, any>} object 
 * @param {string} keySubstring
 */
const byPartialKey = (object, keySubstring) => {
  for (let key in object) {
    if (key.indexOf(keySubstring) >= 0)
      return object[key];
  }
  return undefined;
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if ('start' === message) {
    let result = {};
    try {
      let tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      result.icon = tab.favIconUrl;
      result.title = tab.title;
      result.url = tab.url;

      let page = {};    

      let scriptResults = await browser.scripting.executeScript({
        target: { tabId: tab.id},
        func: () => {
          let metaObject = {
            "html_title": document.head.querySelector("title").textContent 
          };
          for (let meta of document.head.querySelectorAll('meta')) {
            const property = meta.getAttribute('property') 
              || meta.getAttribute('name')
              || meta.getAttribute('itemprop')
              || meta.getAttribute('charset');
            const content = meta.getAttribute("content");
            if (property && content)
			        metaObject[property.toLowerCase()] = content;
          }

          let schema = document.querySelector('script[type="application/ld+json"]');
          if (schema)
            metaObject.schema = JSON.parse(schema.innerHTML);
          else
            metaObject.schema = {};

          let urlLink = document.querySelector('link[rel="canonical"]')
            || document.querySelector('link[rel="alternate"][hreflang="x-default"]');
          if (urlLink)
            metaObject.url = urlLink.getAttribute("href");

          return {
            meta: metaObject,
            html: document.documentElement.outerHTML
          };
        }
      })
      page = scriptResults[0].result;

      //result.meta = page.meta;
      ensurePath(page.meta.schema, ["author"]);
      ensurePath(page.meta.schema, ["brand"]);
  
      result.author = page.meta.schema.author.name
        || page.meta.schema.brand.name
        || page.meta.author
        || page.meta["article:author"];
      result.date = page.meta.schema.dateModified
        || page.meta.schema.datePublished
        || page.meta.schema.dateCreated
        || byPartialKey(page.meta, "updated_time")
        || byPartialKey(page.meta, "modified_time")
        || byPartialKey(page.meta, "published_time")
        || byPartialKey(page.meta, "release_date")
        || page.meta["date"]
        || byPartialKey(page.meta, "dc.date")
        || byPartialKey(page.meta, "dcterms.date")
        || byPartialKey(page.meta, "dc:date")
        || byPartialKey(page.meta, "dc:created");
      result.description = page.meta["og:description"] 
        || page.meta["twitter:description"]
        || page.meta.description
        || page.meta.schema.articleBody
        || page.meta.schema.description;
      result.image = page.meta["og:image:secure_url"] 
        || page.meta["og:image:url"]
        || page.meta["og:image"]
        || page.meta["twitter:image:src"]
        || page.meta["twitter:image"]
        || page.meta["image"]
        || ((page.meta.schema.image ?? [])[0] ?? {}).url
        || (page.meta.schema.image ?? {}).url
        || page.meta.schema.image;
      result.title = page.meta["og:title"] 
        || page.meta["twitter:title"]
        || page.meta.html_title
        || page.meta.schema.headline
        || result.title;
      result.url = page.meta["og:url"]
        || page.meta["twitter:url"]
        || page.meta.url
        || result.url;
    } catch (err) {
      result.error = JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
    return result;
  }
});