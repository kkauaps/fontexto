# Fontexto — my access (browser extension)

Lets [fontexto.com](https://fontexto.com) download the PDF of a cited work that has no free copy, **with the reader's own
access**: the university network, a library login (EZproxy or similar) or a publisher account.

- Runs only on fontexto.com (and Fontexto's local development ports).
- The page can only ask for a **DOI**. The extension resolves it through doi.org, or through the library prefix set in the
  extension's popup, and follows only the PDF link the publisher's page declares (`citation_pdf_url` and similar).
- It only ever returns a real PDF (`%PDF-`, up to 40 MB), never a web page. Nothing goes through Fontexto's servers.

## Try it locally

1. Chrome or Edge → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → choose this `extension/` folder.
3. Open fontexto.com → References → **Look up free PDFs**. References without a free copy are then tried with your
   access, and each one also gets a **Download with my access** button.

## Publish

Zip the contents of this folder (`manifest.json` at the root of the zip) and upload it in the
[Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). The same zip works for
Microsoft Edge Add-ons.

`host_permissions: <all_urls>` is needed because publishers are on many domains; the store asks for a short
justification: "Downloads, at the user's request on fontexto.com, the PDF of a DOI from its publisher with the user's
own institutional access."
