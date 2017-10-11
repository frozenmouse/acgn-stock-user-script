// ==UserScript==
// @name         ACGN股票系統每股營利外掛
// @namespace    http://tampermonkey.net/
// @version      2.800
// @description  try to take over the world!
// @author       papago & Ming & frozenmouse
// @match        http://acgn-stock.com/*
// @match        https://acgn-stock.com/*
// @grant        none
// ==/UserScript==

//版本號為'主要版本號 + "." + 次要版本號 + 錯誤修正版本號(兩位)，ex 1.801
//修復導致功能失效的錯誤或更新重大功能提升主要或次要版本號
//優化UI，優化效能，優化小錯誤更新錯誤版本號
//一旦主要版本號或次要版本號更動，就會跳UI提是使用者更新腳本
//兩個錯誤修正版本號防止迫不得已進位到次要版本號
//版本更新會每十分鐘確認一次

// 觀察頁面載入狀態
function observeLoadingOverlay() {
  new MutationObserver(mutations => {
    mutations.filter(m => m.attributeName === "class").forEach(m => {
      if (m.target.classList.contains("d-none")) {
        onPageLoaded();
      } else {
        onPageLoading();
      }
    });
  }).observe($("#loading .loadingOverlay")[0], { attributes: true });
}

function onPageLoading() {
  console.log(`Page loading: ${document.location.href}`);
}

function onPageLoaded() {
  const currentUrl = document.location.href;
  console.log(`Page loaded: ${currentUrl}`);

  // 頁面 url 樣式的回呼表
  const urlPatternCallbackTable = [
    { pattern: /company\/[0-9]+/, callback: onStockSummaryPageLoaded },
    { pattern: /company\/detail/, callback: onCompanyDetailPageLoaded },
    { pattern: /accountInfo/, callback: onAccountInfoPageLoaded },
    { pattern: /foundation\/[0-9]+/, callback: onFoundationPlanPageLoaded },
  ];

  urlPatternCallbackTable.forEach(({ pattern, callback }) => {
    if (currentUrl.match(pattern)) {
      // loadingOverlay 消失後，需要給點時間讓頁面的載入全部跑完
      setTimeout(callback, 100);
    }
  });
}

function onStockSummaryPageLoaded() {
  computeAssets();
}

function onCompanyDetailPageLoaded() {
  checkCompanyDetailFolderStates();
  addCompanyDetailFolderClickListeners();
}

function onAccountInfoPageLoaded() {
  addTaxCalcFolder();   // 稅率資料夾
  detectOwnStockInfo(); // 持股資訊資料夾
}

function onFoundationPlanPageLoaded() {
  addAdditionalFoundationPlanInfo();
  addFoundationPlanSearchInputListener();
}

const getJsonObj = (() => {
  const jsonUrl = "https://jsonbin.org/abcd1357/ACGNstock-company";
  let jsonObjCache = null;

  return () => {
    // 考慮資料更新週期極長，已有資料就不用再拿了
    if (jsonObjCache === null) {
      const request = new XMLHttpRequest();
      request.open("GET", jsonUrl, false); // 同步連線 GET 到該連線位址
      request.send();
      jsonObjCache = JSON.parse(request.responseText);
    }
    return jsonObjCache;
  };
})();

// 程式進入點
(function mainfunction() {
  observeLoadingOverlay();
  //全域事件
  setTimeout(addNavItems, 0); // 新增上方按鈕
  setTimeout(checkScriptUpdates, 0);
})();

// Header新增按鈕並監聽
function addNavItems() {
  // 按鍵需要以倒序插入，後加的按鍵會排在左邊

  const insertionTarget = $(".note")[2];

  // 關於插件
  $(`<li class="nav-item"><a class="nav-link" href="#" id="about-script">${t("aboutScript")}</a></li>`)
    .insertAfter(insertionTarget);
  $("#about-script").on("click", showAboutScript);

  // 選擇語言
  $(`
    <div class="note">
      <li class="nav-item dropdown">
        <a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown">${t("language")}</a>
        <div class="dropdown-menu px-3" aria-labelledby="navbarDropdownMenuLink" style="display: none;" id="lang-menu"/>
      </li>
    </div>
  `).insertAfter(insertionTarget);
  $("#lang-menu").append($(`
    <li class="nav-item"><a class="nav-link" href="#" id="lang-tw">台灣話</a></li>
    <li class="nav-item"><a class="nav-link" href="#" id="lang-marstw">ㄏㄒㄨ</a></li>
    <li class="nav-item"><a class="nav-link" href="#" id="lang-en">English</a></li>
    <li class="nav-item"><a class="nav-link" href="#" id="lang-jp">日本語</a></li>
  `));
  $("#lang-tw").on("click", () => { changeLanguage("tw"); });
  $("#lang-marstw").on("click", () => { changeLanguage("marstw"); });
  $("#lang-en").on("click", () => { changeLanguage("en"); });
  $("#lang-jp").on("click", () => { changeLanguage("jp"); });

  // 關閉廣告
  $(`<li class="nav-item"><a class="nav-link" href="#" id="block-ads">${t("blockAds")}</a></li>`)
    .insertAfter(insertionTarget);
  $("#block-ads").on("click", blockAds);
}

//---------------擋廣告---------------//
function blockAds() {
  console.log("blockAds");
  // 自動對所有廣告點擊關閉
  $(".fixed-bottom .media.bg-info.text.px-2.py-1.my-2.rounded .d-flex a").click();
}

/*************************************/
/************UpdateScript*************/

const updateScriptCheckInterval = 600000; // 10 minutes

function checkScriptUpdates() {
  checkGreasyForkScriptUpdate("33359"); // papago
  checkGreasyForkScriptUpdate("33781"); // Ming
  checkGreasyForkScriptUpdate("33814"); // frozenmouse
  setTimeout(checkScriptUpdates, updateScriptCheckInterval);
}

function checkGreasyForkScriptUpdate(id) {
  const scriptUrl = `https://greasyfork.org/zh-TW/scripts/${id}`;
  const request = new XMLHttpRequest();

  request.open("GET", `${scriptUrl}.json`);
  request.addEventListener("load", function() {
    const remoteVersion = JSON.parse(this.responseText).version;
    const localVersion = GM_info.script.version;

    console.log(`檢查 GreasyFork 腳本版本：id = ${id}, remoteVersion = ${remoteVersion}, localVersion = ${localVersion}`);

    // 版本號 a.bcc，只有 a 或 b 變動才通知更新
    if (remoteVersion.substr(0, 3) > localVersion.substr(0, 3) && $(`update-script-button-greasy-${id}`).length === 0) {
      $(`
        <li class="nav-item">
          <a class="nav-link btn btn-primary" href="${scriptUrl}" id="update-script-button-greasy-${id}" target="_blank">${t("updateScript")}</a>
        </li>
      `).insertAfter($(".nav-item").last());
    }
  });
  request.send();
}
/************UpdateScript*************/
/*************************************/

/************ 股市總覽 stock summary *************/
function computeAssets() {
  let assets = 0;

  const isInCardMode = $(".col-12.col-md-6.col-lg-4.col-xl-3").length > 0;

  if (isInCardMode) {
    // 卡片模式
    $(".company-card").each((i, e) => {
      const price = Number(e.innerText.match(/\$ [0-9]+\(([0-9]+)\)/)[1]);
      const hold = Number(e.innerText.match(/([0-9]+).+%.+/)[1]);
      const subtotal = price * hold;
      console.log(`價=${price}, 持=${hold}, 總=${subtotal}`);
      assets += subtotal;
    });
  } else {
    // 列表模式
    $(".media-body.row.border-grid-body").each((i, e) => {
      const price = Number(e.innerText.match(/\$ [0-9]+\(([0-9]+)\)/)[1]);
      const hold = Number(e.innerText.match(/您在該公司持有([0-9]+)數量的股份/)[1]);
      const subtotal = price * hold;
      console.log(`價=${price}, 持=${hold}, 總=${subtotal}`);
      assets += subtotal;
    });
  }

  console.log("本頁持股價值: " + assets);
  if ($("#totalAssetsNumber").length === 0) {
    $(`
      <div class="media company-summary-item border-grid-body" id="totalAssets">
        <div class="col-6 text-right border-grid" id="totalAssetsTitle">
          <h2>${t("totalAssetsInThisPage")}</h2>
        </div>
      </div>
    `).insertAfter($(".card-title.mb-1")[0]);
    $(`<div class="col-6 text-right border-grid" id="totalAssetsNumber"/>`)
      .insertAfter($("#totalAssetsTitle")[0]);
  }
  $("#totalAssetsNumber").html(`<h2>$ ${assets}</h2>`);
}
/************ 股市總覽 stock summary *************/

/************** 公司資訊 company detail ****************/
// 資料夾名稱，對照 data-toggle-panel 屬性
const companyDetailFolderNames = [
  "chart",      // 股價趨勢
  "numbers",    // 數據資訊
  "order",      // 交易訂單
  "products",   // 產品中心
  "director",   // 董事會
  "log",        // 所有紀錄
];

// 資料夾開 / 關時的 callback
const companyDetailFolderCallbacks = {
  "numbers": {
    "open": () => {
      console.log("Open numbers folder");
      addAdditionalNumbersData();
    },
    "close": () => {
      console.log("Close numbers folder");
      removeAdditionalNumbersInfo();
    },
  },
};

function onCompanyDetailFolderStateChanged(folderName, isOpen) {
  if (companyDetailFolderCallbacks[folderName] !== undefined) {
    const callback = companyDetailFolderCallbacks[folderName][isOpen ? "open" : "close"];
    if (callback !== undefined) callback();
  }
}

function checkCompanyDetailFolderStates() {
  setTimeout(() => {
    $(".d-block.h4").each((i, e) => {

      const folderIcon = $(e).find("i");
      if (folderIcon.hasClass("fa-folder-open")) {
        onCompanyDetailFolderStateChanged(companyDetailFolderNames[i], true);
      } else if (folderIcon.hasClass("fa-folder")) {
        onCompanyDetailFolderStateChanged(companyDetailFolderNames[i], false);
      }
    });
  }, 0); // 給點時間時等待更新後再 check
}

function addCompanyDetailFolderClickListeners() {
  $(".d-block.h4")
    .off("click", checkCompanyDetailFolderStates) // 避免重複加入事件
    .on("click", checkCompanyDetailFolderStates);
}

// 計算每股盈餘、本益比、益本比並顯示
function addAdditionalNumbersData() {
  // 先移除之前新增的資訊
  removeAdditionalNumbersInfo();

  const dataValueCells = $(".col-8.col-md-4.col-lg-2.text-right.border-grid");

  const stockPrice = Number(dataValueCells[0].innerHTML.match(/[0-9]+/));
  const revenue = Number(dataValueCells[3].innerHTML.match(/[0-9]+/));
  const totalStock = Number(dataValueCells[4].innerHTML.match(/[0-9]+/));

  const earnPerShare = 0.8075 * revenue / totalStock;
  const PERatio = earnPerShare === 0 ? Infinity : stockPrice / earnPerShare;
  const benefitRatio = earnPerShare / stockPrice;

  function insertData(id, name, value) {
    $("[data-toggle-panel=numbers]").parent().nextUntil(".col-12.border-grid").last()
      .after(`
        <div id="${id}" class="col-4 col-md-2 col-lg-2 text-right border-grid">${name}</div>
        <div id="${id}-value" class="col-8 col-md-4 col-lg-2 text-right border-grid">${value}</div>
      `);
  }

  insertData("earn-per-share", dict[currentLanguage].earnPerShare, earnPerShare.toFixed(2));
  insertData("pe-ratio", dict[currentLanguage].PERatio, PERatio === Infinity ? "∞" : PERatio.toFixed(2));
  insertData("benefit-ratio", dict[currentLanguage].benefitRatio, benefitRatio.toFixed(2));
  console.log("addSomeInfo!!");
}

// 清出額外新增的資訊
function removeAdditionalNumbersInfo() {
  $("#earn-per-share, #earn-per-share-value, #pe-ratio, #pe-ratio-value, #benefit-ratio, #benefit-ratio-value").remove();
}
/************** 公司資訊 company detail ****************/

/************ 帳號資訊 account info **************/
/************* 持股資訊 & 金額試算 ***/
function detectOwnStockInfo() {
  const jsonObj = getJsonObj();

  const ownStockList = $("[data-toggle-panel=stock]").parent().next().children().filter((i, e) => e.innerHTML.match(/擁有.+公司的.+股票/));
  if (ownStockList.length === 0) return;  // 持股資訊未開啟 or 無資料

  if ($("#compute-btn").length === 0) {
    $(`<button class="btn btn-danger btn-sm" type="button" id="compute-btn">計算此頁資產</button>`)
      .on("click", detectOwnStockInfo)
      .insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  if ($("#clear-asset-message-btn").length === 0) {
    $(`<button class="btn btn-danger btn-sm" type="button" id="clear-asset-message-btn">清除總資產訊息</button>`)
      .on("click", () => $("#asset-display-div").remove())
      .insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  if ($("#asset-display-div").length === 0) {
    $(`
      <div id="asset-display-div">
        <p>公司股價更新時間為 ${jsonObj.updateTime}</p>
        <p>目前共有<span id="total-asset">0</span>元資產</p>
      </div>
    `).insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  let total = 0;
  ownStockList.each((i, e) => {
    const companyLinkMatchResult = e.innerHTML.match(/href="([^"]+)/);
    if (!companyLinkMatchResult) return;

    const companyData = jsonObj.companys.find(e => e.companyLink === companyLinkMatchResult[1]);
    if (!companyData) return;

    const price = Number(companyData.companyPrice);
    const amount = Number(e.innerHTML.match(/([0-9]+)股/)[1]);
    const subtotal = price * amount;
    total += subtotal;

    if (!e.innerHTML.match(/參考股價/)) {
      e.innerHTML += `參考股價 ${price} 元，有 ${subtotal} 元資產。`;
    }
  });

  const pageNum = $(".page-item.active").text();
  $("#asset-display-div").append(`<p>第 ${pageNum} 頁共有 ${total} 元資產</p>`);
  $("#total-asset").text((_, old) => Number(old) + total);
}

/************* 稅率試算 *********************/

// 稅率表：資產上限、稅率、累進差額
const taxRateTable = [
  { asset: 10000, rate: 0.00, adjustment: 0 },
  { asset: 100000, rate: 0.03, adjustment: 300 },
  { asset: 500000, rate: 0.06, adjustment: 3300 },
  { asset: 1000000, rate: 0.09, adjustment: 18300 },
  { asset: 2000000, rate: 0.12, adjustment: 48300 },
  { asset: 3000000, rate: 0.15, adjustment: 108300 },
  { asset: 4000000, rate: 0.18, adjustment: 198300 },
  { asset: 5000000, rate: 0.21, adjustment: 318300 },
  { asset: 6000000, rate: 0.24, adjustment: 468300 },
  { asset: 7000000, rate: 0.27, adjustment: 648300 },
  { asset: 8000000, rate: 0.30, adjustment: 858300 },
  { asset: 9000000, rate: 0.33, adjustment: 1098300 },
  { asset: 10000000, rate: 0.36, adjustment: 1368300 },
  { asset: 11000000, rate: 0.39, adjustment: 1668300 },
  { asset: 12000000, rate: 0.42, adjustment: 1998300 },
  { asset: 13000000, rate: 0.45, adjustment: 2358300 },
  { asset: 14000000, rate: 0.48, adjustment: 2748300 },
  { asset: 15000000, rate: 0.51, adjustment: 3168300 },
  { asset: 16000000, rate: 0.54, adjustment: 3618300 },
  { asset: 17000000, rate: 0.57, adjustment: 4098300 },
  { asset: Infinity, rate: 0.60, adjustment: 4608300 },
];

// 加入稅金試算資料夾
function addTaxCalcFolder() {
  if ($("#tax-calc").length !== 0) return;

  $(".row.border-grid-body").append(`
    <div class="col-12 border-grid" id="tax-calc">
      <a class="d-block h4" href="" data-toggle-panel="tax-calc">
        ${t("taxCalculation")} <i class="fa fa-folder"/>
      </a>
    </div>
  `);

  $("[data-toggle-panel=tax-calc]").on("click", () => {
    const folderIcon = $("#tax-calc .fa");

    if (folderIcon.hasClass("fa-folder")) {
      folderIcon.addClass("fa-folder-open").removeClass("fa-folder");

      $("#tax-calc").after(`
        <div class="col-12 text-right border-grid" id="tax-calc-content">
          <h5>${t("enterTotalAssets")}</h5>
          <input id="tax-calc-input" class="form-control" type="text">
          <h5>${t("yourTax")} <span id="tax-calc-output">$ 0</span></h5>
        </div>
      `);

      // 輸入時即時運算稅金
      $("#tax-calc-input").on("input", () => {
        const input = Number($("#tax-calc-input").val().match(/[0-9]+/));
        const { rate, adjustment } = taxRateTable.find(e => input < e.asset);
        const output = Math.ceil(input * rate - adjustment);
        $("#tax-calc-output").text(`$ ${output}`);
      });
    } else {
      folderIcon.addClass("fa-folder").removeClass("fa-folder-open");
      $("#tax-calc-content").remove();
    }
  });
}
/************ 帳號資訊 account info **************/

/************ 新創計劃 foundation plan ***********/
// 從總投資額推算新創公司的預計股價
function computeStockPriceFromTotalFund(totalFund) {
  let result = 1;
  while (totalFund / 1000 > result) result *= 2;
  return Math.max(1, result / 2);
}

// 計算新創公司的額外資訊
function computeAdditionalFoundationPlanInfo(i, inCardMode) {
  const personalFund = Number(
    inCardMode
      ? $(".company-card-mask")[i].children[6].innerText.match(/[0-9]+/)[0]
      : ($(`.media-body.row.border-grid-body:eq(${i}) .mb-1`)[0].innerText.match(/[0-9]+/) || [0])[0]
  );

  const totalFund = Number(
    inCardMode
      ? $(".company-card-mask")[i].children[5].innerText.match(/[0-9]+/)[0]
      : $(`.media-body.row.border-grid-body:eq(${i}) .col-8.col-lg-3.text-right.border-grid:eq(3)`)[0].innerText.match(/[0-9]+/)[0]
  );

  const stockPrice = computeStockPriceFromTotalFund(totalFund);
  const stockAmount = personalFund / stockPrice;
  const stockRight = personalFund / totalFund;
  return { stockPrice, stockAmount, stockRight };
}

function addAdditionalFoundationPlanInfo() {
  const displayModeIcon = $(".btn.btn-secondary.mr-1 i");
  const inCardMode = displayModeIcon.hasClass("fa-th");

  const companies = $(inCardMode ? ".company-card-mask" : ".media-body.row.border-grid-body");
  companies.each((i, e) => {
    console.log(`${i}: ${$(e).find(".title-starter").text().trim()}`);
    if ($(e).find("div[name=foundationPlanNewInfo]").length !== 0) return;

    const { stockPrice, stockAmount, stockRight } = computeAdditionalFoundationPlanInfo(i, inCardMode);

    if (inCardMode) {
      $(e).find(".row-info").last().after(`
        <div name="foundationPlanNewInfo" class="row row-info d-flex justify-content-between">
          <p>${t("foundationPlanStockPrice")}</p>
          <p>$${stockPrice}</p>
        </div>
        <div name="foundationPlanNewInfo" class="row row-info d-flex justify-content-between">
          <p>${t("foundationPlanShare")}</p>
          <p>${Math.floor(stockAmount)}股</p>
        </div>
        <div name="foundationPlanNewInfo" class="row row-info d-flex justify-content-between">
          <p>${t("foundationPlanStock")}</p>
          <p>${(stockRight * 100).toFixed(2)}%</p>
        </div>
      `);
    } else {
      $(e).find(".col-8.col-lg-3.text-right.border-grid:eq(3)").after(`
        <div name="foundationPlanNewInfo" class="col-4 col-lg-6 text-right border-grid" />
        <div name="foundationPlanNewInfo" class="col-4 col-lg-3 text-right border-grid">${t("foundationPlanStockPrice")}</div>
        <div class="col-8 col-lg-3 text-right border-grid" id="customStockPrice${i}">$${stockPrice}</div>
        <div name="foundationPlanNewInfo" class="col-4 col-lg-3 text-right border-grid">${t("foundationPlanShare")}</div>
        <div class="col-8 col-lg-3 text-right border-grid" id="customStockAmount${i}">${Math.floor(stockAmount)}股</div>
        <div name="foundationPlanNewInfo" class="col-4 col-lg-3 text-right border-grid">${t("foundationPlanStock")}</div>
        <div class="col-8 col-lg-3 text-right border-grid" id="customStockRight${i}">${(stockRight * 100).toFixed(2)}%</div>
      `);
    }
  });
}

function addFoundationPlanSearchInputListener() {
  // 既有公司搜尋提示
  $(".form-control")
    .off("input", listExistingCompanies)  // 避免重複加入事件
    .on("input", listExistingCompanies);
}

// 找尋並顯示在 jsonObj 裡已建檔的公司名冊
function listExistingCompanies() {
  if ($("#displayResult").length !== 0) {
    $("#displayResult").remove();
  }

  const searchString = $(".form-control").val();
  if (!searchString) return;

  const searchRegExp = new RegExp(searchString, "i");
  const jsonObj = getJsonObj();
  const matchedCompanies = jsonObj.companys.filter(c => searchRegExp.test(c.companyName) || searchRegExp.test(c.companyTags));  // WTF!?

  $(`
    <div id="displayResult" style="display: block; height: 100px; margin-top: 16px; overflow: scroll; overflow-x: hidden;">
      <p>公司名冊更新於 ${jsonObj.updateTime}</p>
      <p>${matchedCompanies.map(c => `<a href="${c.companyLink}">${c.companyName}</a>`).join(", ")}</p>
    </div>
  `).insertAfter($(".form-inline"));
}
/************ 新創計劃 foundation plan ***********/

/**************aboutMe****************/

function showAboutScript() {
  $(".card-block").remove();
  $(".card").append(`
    <div class="card-block">
      <div class="col-5"><h1 class="card-title mb-1">關於插件</h1></div>
      <div class="col-5">by papago89, Ming, frozenmouse</div>
      <div class="col-12">
        <hr>
        <p>要離開本頁面記得點進來的那一頁以外的其他頁面</p>
        <hr>
        <p>
          本插件功能不定時增加中，目前功能有以下幾個：
          <ul>
            <li>在頁面<span class="text-info">股市總覽</span>可以查看本頁股票總值，建議開啟<span class="text-info">只列出我所持有的股票</span></li>
            <li>在頁面<span class="text-info">新創計畫</span>可以查看推測股價、推測股權、推測應得股數</li>
            <li>在頁面<span class="text-info">新創計畫</span>搜尋欄鍵入文字時會提示股市總覽中是否已存在相同名稱或標籤之公司</li>
            <li>在各公司頁面數據資訊處增加每股盈餘、本益比、益本比</li>
            <li>在頁面<span class="text-info">帳號資訊</span>增加稅金試算，輸入總資產後就會算出你應該繳的稅金</li>
            <li>在頁面<span class="text-info">帳號資訊</span>增加資產換算</li>
            <li>按鈕<span class="text-info">廣告關閉</span>隱藏所有廣告讓你什麼都看不到</li>
            <li>在頁面<span class="text-info">關於插件</span>增加插件功能介紹，版本更新紀錄，還有廢話</li>
            <li>按鈕<span class="text-info">點我更新插件</span>在greasyfork有新版本時會自動跳出提示大家更新</li>
            <li>按鈕<span class="text-info">選擇語言</span>可以更改語言，不過要重新整理頁面才會生效</li>
          </ul>
        </p>
        <hr>
        <p>有任何問題或建議請到Discord:ACGN Stock留言</p>
        <p><a href="https://greasyfork.org/zh-TW/scripts/33359-acgn%E8%82%A1%E7%A5%A8%E7%B3%BB%E7%B5%B1%E6%AF%8F%E8%82%A1%E7%87%9F%E5%88%A9%E5%A4%96%E6%8E%9B" target="_blank">更新插件</a></p>
      </div>
    </div>

    <div class="card-block">
      <div class="row border-grid-body" style="margin-top: 15px;">
        <div class="col-12 border-grid" id="release-history-folder">
          <a class="d-block h4" href="" data-toggle-panel="update">更新紀錄 <i class="fa fa-folder" aria-hidden="true" /></a>
        </div>
      </div>
    </div>
  `);

  const releaseHistoryFolder = $("#release-history-folder");
  releaseHistoryFolder.on("click", () => {
    const releaseHistoryFolderIcon = releaseHistoryFolder.find(".fa");
    if (releaseHistoryFolderIcon.hasClass("fa-folder")) {
      releaseHistoryFolderIcon.removeClass("fa-folder").addClass("fa-folder-open");
      releaseHistoryFolder.after((releaseHistoryList.map(({ version, description }) => createReleaseHistoryDiv(version, description)).join("")));
    } else {
      releaseHistoryFolderIcon.removeClass("fa-folder-open").addClass("fa-folder");
      releaseHistoryFolder.nextAll(".col-12.border-grid").remove();
    }
  });
}

const releaseHistoryList = [
  {
    version: "2.800",
    description: `
      <p>滿滿的大重構。</p>
      <p><span class="text-info">更新腳本</span>增加了與frozenmouse發佈版本的連動。</p>
    `,
  },
  {
    version: "2.500",
    description: `<p><span class="text-info">更新腳本</span>連動到Ming，現在Ming也可以自己發布新版腳本讓大家更新了。</p>`,
  }, {
    version: "2.300",
    description: `<p>移除<span class="text-info">訂閱</span>功能</p>`,
  }, {
    version: "2.200",
    description: `
      <p>新增<span class="text-info">新創搜尋提示</span>功能</p>
      <p>新增<span class="text-info">帳號頁面持股換算資產</span>功能</p>
    `,
  }, {
    version: "2.000",
    description: `<p>新增<span class="text-info">訂閱</span>功能</p>`,
  }, {
    version: "1.900",
    description: `<p>新增<span class="text-info">選擇語言</span></p>`,
  }, {
    version: "1.800",
    description: `<p>新增<span class="text-info">點我更新插件</span>按鈕</p>`,
  }, {
    version: "1.73",
    description: `
      <p><span class="text-info">更新插件</span>連結現在會在新分頁開啟連結，讓原本的頁面可以繼續看股票。</p>
      <p>修正<span class="text-info">關於插件</span>中，更新紀錄排序錯亂的問題。</p>
      <p>新增<span class="text-info">新創計畫</span>下，列表模式的推測股價、推測股權、推測應得股數。</p>
      <p>優化一些日誌顯示，讓開發人員在除錯更方便一些。</p>
    `,
  }, {
    version: "1.72",
    description: `
      <p>優化<span class="text-info">廣告關閉</span>功能。</p>
      <p>好像還有新增一些功能什麼的。</p>
    `,
  }, {
    version: "1.70",
    description: `<p>新增功能<span class="text-info">廣告關閉</span>將會隱藏所有廣告，按過後只要不關閉頁面你就再也看不到任何廣告了，包含公告以及新發布的廣告。</p>`,
  }, {
    version: "1.63",
    description: `<p>修正<span class="text-info">股市總覽</span>中列表模式如果出現有交易尚未完成會造成計算錯誤</p>`,
  }, {
    version: "1.62",
    description: `<p>新增頁面<span class="text-info">關於插件</span></p>`,
  }, {
    version: "1.61以前",
    description: `<p>新增了一些功能，不過不是很重要</p>`,
  },
];

function createReleaseHistoryDiv(version, description) {
  return `
    <div class="col-12 border-grid">
      <h4>版本${version}：</h4>
      ${description}
    </div>
  `;
}

/**************aboutMe****************/
/*************Language****************/

let currentLanguage = window.localStorage.getItem("PM_language") || "tw";

function changeLanguage(language) {
  if (currentLanguage === language) return;
  currentLanguage = language;
  window.localStorage.setItem("PM_language", language);
  window.location.reload();
}

// 翻譯米糕
function t(key) {
  return dict[currentLanguage][key];
}

const dict = {
  tw: {
    language: "選擇語言",
    blockAds: "關閉廣告",
    aboutScript: "關於插件",
    updateScript: "更新腳本",
    totalAssetsInThisPage: "本頁股票總值：",
    benefitRatio: "益本比：",
    PERatio: "本益比：",
    earnPerShare: "每股盈餘：",
    taxCalculation: "稅金試算",
    enterTotalAssets: "輸入你的總資產：",
    yourTax: "你應繳的稅金：",
    foundationPlanStock: "當前股權應為：",
    foundationPlanShare: "當前投資應得：",
    foundationPlanStockPrice: "當前股價應為：",
    subscribe: "訂閱公司",
    unsubscribe: "取消訂閱",
    showMySubscribes: "我的訂閱",
    goToCompany: "前往",
  },
  en: {
    language: "language",
    blockAds: "Block Ad",
    aboutScript: "About Script",
    updateScript: "Update Script",
    totalAssetsInThisPage: "Total assets in this page :",
    benefitRatio: "benefit ratio :",
    PERatio: "P/E ratio :",
    earnPerShare: "Earning per share :",
    taxCalculation: "Tax calculation",
    enterTotalAssets: "Enter your total assets :",
    yourTax: "your tax :",
    foundationPlanStock: "Your stock :",
    foundationPlanShare: "your investment will get",
    foundationPlanStockPrice: "Stock price :",
    subscribe: "Subscribe",
    unsubscribe: "Unsubscribe",
    showMySubscribes: "My Subscription",
    goToCompany: "Go to company ",
  },
  jp: {
    language: "言語を選択",
    blockAds: "広告を閉じる",
    aboutScript: "プラグインについて",
    updateScript: "スクリプトを更新する",
    totalAssetsInThisPage: "このページの株式時価総額：",
    benefitRatio: "株式益回り：",
    PERatio: "株価収益率：",
    earnPerShare: "一株利益：",
    taxCalculation: "税金計算",
    enterTotalAssets: "総資産を入力する：",
    yourTax: "あなたの税金：",
    foundationPlanStock: "予想の持株比率：",
    foundationPlanShare: "予想の株式持分：",
    foundationPlanStockPrice: "予想の株価：",
    subscribe: "訂閱公司",
    unsubscribe: "取消訂閱",
    showMySubscribes: "我的訂閱",
    goToCompany: "前往",
  },
  marstw: {
    language: "顯4ㄉ語言",
    blockAds: "關ㄅ廣告",
    aboutScript: "我做ㄌ什麼",
    updateScript: "有☆版",
    totalAssetsInThisPage: "這一ya的股票一共ㄉ錢：",
    benefitRatio: "yee本比：",
    PERatio: "本yee比：",
    earnPerShare: "每ㄍ股票ㄉ或立：",
    taxCalculation: "歲金計算",
    enterTotalAssets: "你ㄉ錢：",
    yourTax: "要交ㄉ稅金：",
    foundationPlanStock: "你占多少趴：",
    foundationPlanShare: "你有多少股：",
    foundationPlanStockPrice: "股價因該4：",
    subscribe: "訂閱這ㄍ工ㄙ",
    unsubscribe: "不訂閱這ㄍ工ㄙ",
    showMySubscribes: "窩ㄉ訂閱",
    goToCompany: "窩要ㄑ找",
  },
};
/*************Language****************/
