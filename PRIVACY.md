# Privacy policy — ImgLoupe

Last updated: October 31, 2026. 繁體中文版本在英文之後。

ImgLoupe helps you preview, copy, download and recognize text in images in Google Docs, Sheets and Slides. It has no developer-operated server, no analytics and no advertising. Questions and requests can be raised at https://github.com/markleetw/imgloupe/issues. Do not attach private documents, image URLs or recognized text to a public issue.

## Information handled

On Google Docs, Sheets and Slides editor pages, the extension reads the image you select, its position on screen, the image addresses the page has loaded and the document title, which is used to name downloaded files. In Google Docs it samples a small, downscaled copy of the selected area to match it to the right image. In Google Sheets, formulas of the form IMAGE("https://…"), either visible in the formula bar or in the exported file, supply image addresses.

When you choose to download all images, the extension asks docs.google.com, using your existing Google session, for the current version of the document: for Sheets and Slides the Office file Google provides under File > Download (.xlsx or .pptx), for Docs the document's basic mobile view, and for Sheets IMAGE formulas also the spreadsheet's HTML view, where Google provides its own copy of those images. Only the images, and for Sheets the addresses in IMAGE formulas, are taken from it in memory; the text and other content are discarded and never stored or sent anywhere. If Google does not provide them, for example because downloading is disabled for the document, the extension packs the images already loaded in the page instead.

## Network requests

Images are downloaded from Google's image servers or, for an IMAGE formula, from the address in the formula. These are ordinary requests from your browser and follow Chrome's cookie and referrer rules. No document content, image, title or recognized text is sent to the developer or to any other service.

## Local processing and storage

Text recognition runs in your browser with the Tesseract engine and English and Traditional Chinese language models included in the extension. The recognized text is written to your clipboard only when you ask for it; other applications may be able to read the clipboard according to your system settings. The language models may be cached in the extension's own browser storage. The extension does not use Chrome storage and keeps no record of documents, images or recognized text; page data is released when the document tab is closed or reloaded. Removing the extension removes its storage.

Downloaded images and ZIP files are saved where Chrome saves your downloads. If some images cannot be downloaded, the ZIP contains a short report (failed-images.txt) listing their location in the document, addresses and the reason; do not share that report publicly if the document is private.

## Permissions

offscreen runs text recognition and a clipboard fallback in a hidden extension page. clipboardWrite lets the copy and text recognition actions write to the clipboard. Access to docs.google.com and googleusercontent.com lets the extension's background page download the Office export of the Sheets or Slides file you are viewing when you ask for a ZIP: Google serves that file from a googleusercontent.com address, which the page itself cannot read. The export address is always derived from the open document; no other address is requested. The content script runs only on docs.google.com document, spreadsheet and presentation pages. The extension requests no access to other websites, browsing history, cookies, downloads or Chrome storage.

## Use of data

Data is used only to provide the image tools described above. It is not sold, not used for advertising or creditworthiness, not transferred to third parties and not used for any purpose unrelated to these tools. This use complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

# ImgLoupe 隱私權政策

最後更新：2026 年 10 月 31 日。

ImgLoupe 讓你在 Google 文件、試算表與簡報中預覽、複製、下載圖片，並辨識圖片中的文字。本擴充功能沒有開發者營運的伺服器，也沒有分析或廣告服務。如有疑問或請求，請至 https://github.com/markleetw/imgloupe/issues 提出；請勿在公開的 Issue 中附上私人文件、圖片網址或辨識出的文字。

## 會處理的資訊

在 Google 文件、試算表與簡報的編輯頁面上，本擴充功能會讀取你選取的圖片、它在畫面上的位置、頁面已載入的圖片網址，以及用來命名下載檔案的文件標題。在 Google 文件中，會擷取所選區域縮小後的小圖，用來比對出正確的圖片。在 Google 試算表中，IMAGE("https://…") 形式的公式（畫面上可見的，或匯出檔中的）會提供圖片網址。

當你選擇打包下載全部圖片時，本擴充功能會以你目前的 Google 登入狀態，向 docs.google.com 取得文件的目前版本：試算表與簡報使用 Google「檔案 > 下載」提供的 Office 檔案（.xlsx 或 .pptx），文件使用其基本行動版檢視頁面；試算表的 IMAGE 公式另外使用試算表的 HTML 檢視頁，其中有 Google 轉存的圖片。只會在記憶體中取出其中的圖片（試算表另外取出 IMAGE 公式中的網址）；文字與其他內容會被捨棄，不會保存或傳送到任何地方。如果 Google 不提供，例如文件已停用下載，則改為打包頁面中已載入的圖片。

## 網路請求

圖片會從 Google 的圖片伺服器下載；若來自 IMAGE 公式，則從公式中的網址下載。這些都是瀏覽器發出的一般請求，遵循 Chrome 的 Cookie 與 Referrer 規則。文件內容、圖片、標題或辨識出的文字都不會傳送給開發者或任何其他服務。

## 本機處理與儲存

文字辨識在你的瀏覽器中進行，使用擴充功能內附的 Tesseract 引擎與英文、繁體中文語言模型。辨識出的文字只有在你要求時才會寫入剪貼簿；依你的系統設定，其他應用程式可能可以讀取剪貼簿。語言模型可能會快取在擴充功能自己的瀏覽器儲存空間中。本擴充功能不使用 Chrome storage，也不保留任何文件、圖片或辨識文字的紀錄；頁面資料會在關閉或重新整理文件分頁時釋放。移除擴充功能時會一併移除其儲存空間。

下載的圖片與 ZIP 檔會存放在 Chrome 的下載位置。若有圖片無法下載，ZIP 內會附一份簡短報告（failed-images.txt），列出其在文件中的位置、網址與原因；如果文件是私人的，請勿公開分享該報告。

## 權限

offscreen 用於在隱藏的擴充功能頁面中執行文字辨識與剪貼簿備援。clipboardWrite 讓複製與文字辨識功能可以寫入剪貼簿。docs.google.com 與 googleusercontent.com 的存取權，讓擴充功能的背景頁面在你要求打包 ZIP 時，下載你正在檢視的試算表或簡報的 Office 匯出檔：Google 從 googleusercontent.com 網址提供這份檔案，頁面本身無法讀取。匯出網址一律依目前開啟的文件產生，不會請求其他網址。內容腳本只在 docs.google.com 的文件、試算表與簡報頁面上執行。本擴充功能不要求存取其他網站、瀏覽紀錄、Cookie、下載紀錄或 Chrome storage。

## 資料用途

資料只用於提供上述圖片功能，不會出售、不會用於廣告或信用評估、不會轉移給第三方，也不會用於與這些功能無關的目的。此用途符合 Chrome 線上應用程式商店使用者資料政策，包括其有限使用（Limited Use）規定。
