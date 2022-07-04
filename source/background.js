// eslint-disable-next-line import/no-unassigned-import
import './options-storage.js';
import browser from 'webextension-polyfill';

// https://github.com/zotero/translate

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

const processAirbnbState = (state) => {
  try {
    let root = state.niobeMinimalClientData[0][1].data.presentation;
    console.log("Airbnb processing");
    let groups = {};
    groupAirbnbByType(root, groups);
    console.log(groups);
    return groups;
  } catch (err) {
    return null;
  }
}

const groupAirbnbByType = (current, groups) => {
  let typeName = current["__typename"] ?? "unknown";
  let list = groups[typeName] ?? [];
  groups[typeName] = list;
  list.push(current);
  for (let key in current) {
    if (current[key] && current[key]["__typename"]) {
      groupAirbnbByType(current[key], groups);
    } else if (Array.isArray(current[key])) {
      for (let child of current[key].filter(c => c && c["__typename"]))
        groupAirbnbByType(child, groups);
    }
  } 
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if ('start' === message) {
    let result = {};
    try {
      let tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      let page = {};    

      let scriptResults = await browser.scripting.executeScript({
        target: { tabId: tab.id},
        func: () => {
          let result = {
            html: document.documentElement.outerHTML,
            title: document.head.querySelector("title").textContent,
            meta: {}
          };
          for (let meta of document.head.querySelectorAll('meta')) {
            const property = meta.getAttribute('property') 
              || meta.getAttribute('name')
              || meta.getAttribute('itemprop')
              || meta.getAttribute('charset');
            const content = meta.getAttribute("content");
            if (property && content)
			        result.meta[property.toLowerCase()] = content;
          }

          let urlLink = document.querySelector('link[rel="canonical"]')
            || document.querySelector('link[rel="alternate"][hreflang="x-default"]');
          if (urlLink)
            result.url = urlLink.getAttribute("href");

          let schema = document.querySelector('script[type="application/ld+json"]');
          if (schema)
            result.schema = JSON.parse(schema.innerHTML);
          else
            result.schema = {};

          // Airbnb
          let airbnbState = document.querySelector('#data-deferred-state[type="application/json"]');
          if (airbnbState)
            result.airbnbState = JSON.parse(airbnbState.innerHTML);
          return result;
        }
      })
      page = scriptResults[0].result;

      Object.assign(result, page.schema);

      if (!result.author && !result.brand) {
        let authorName = page.meta.author
          || page.meta["article:author"];
        if (authorName)
          result.author = {
            name: authorName
          };
      }
      if (!result.dateCreated) {
        result.dateCreated = byPartialKey(page.meta, "dc:created");
      }
      if (!result.dateModified) {
        result.dateModified = byPartialKey(page.meta, "updated_time")
          || byPartialKey(page.meta, "modified_time")
          || page.meta["date"]
          || byPartialKey(page.meta, "dc.date")
          || byPartialKey(page.meta, "dcterms.date")
          || byPartialKey(page.meta, "dc:date")
      }
      if (!result.datePublished) {
        result.datePublished = byPartialKey(page.meta, "published_time")
          || byPartialKey(page.meta, "release_date")
      }
      if (!result.description) {
        result.description = page.meta["og:description"] 
          || page.meta["twitter:description"]
          || page.meta.description;
      }
      result.icon = tab.favIconUrl;
      if (!result.image) {
        result.image = page.meta["og:image:secure_url"] 
          || page.meta["og:image:url"]
          || page.meta["og:image"]
          || page.meta["twitter:image:src"]
          || page.meta["twitter:image"]
          || page.meta["image"];
      }
      if (!result.name) {
        result.name = page.meta["og:title"] 
          || page.meta["twitter:title"]
          || page.title
          || tab.title;
      }
      if (!result.url) {
        result.url = page.meta["og:url"]
          || page.meta["twitter:url"]
          || page.url
          || tab.url;
      }

      if (page.airbnbState) {
        result["@context"] = "http://schema.org";
        result["@type"] = result["@type"] ?? "BedAndBreakfast";

        let airbnbGroups = processAirbnbState(page.airbnbState);
        let location = (airbnbGroups["LocationSection"] ?? [])[0] ?? {};
        result.latitude = location.lat;
        result.longitude = location.lng;
        result.address = {
          "streetAddress": location.subtitle
        }

        let policies = (airbnbGroups["PoliciesSection"] ?? [])[0] ?? { };
        result.additionalHouseRules = policies.additionalHouseRules;
        if (policies.houseRules) {
          result.houseRules = policies.houseRules.map(r => r.title);
        }

        let overview = (airbnbGroups["PdpOverviewSection"] ?? [])[0] ?? { };
        if (overview.detailItems) {
          result.amenityFeature = overview.detailItems.map(i => ({"value": i.title}));
        }

        let sharingConfig = (airbnbGroups["PdpSharingConfig"] ?? [])[0] ?? { };
        result.personCapacity = sharingConfig.personCapacity;
        result.propertyType = sharingConfig.propertyType;
        result.aggregateRating = {
          "@type": "AggregateRating",
          "bestRating": 5,
          "ratingValue": sharingConfig.starRating,
          "reviewCount": sharingConfig.reviewCount
        }
      }
    } catch (err) {
      result.error = JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
    return result;
  }
});