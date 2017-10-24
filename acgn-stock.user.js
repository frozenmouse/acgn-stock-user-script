// ==UserScript==
// @name         ACGN股票系統每股營利外掛
// @namespace    http://tampermonkey.net/
// @version      2.811
// @description  try to take over the world!
// @author       papago & Ming & frozenmouse
// @match        http://acgn-stock.com/*
// @match        https://acgn-stock.com/*
// @grant        none
// ==/UserScript==

/**
 * 版本號格式為：a.bcc
 * a 為主要版本號，一位數
 * b 為次要版本號，一位數
 * c 為錯誤修正版本號，兩位數
 *
 * e.g., 版本號 2.801 => a = '2', b = '8', c = '01'
 *
 * 修復導致功能失效的錯誤或更新重大功能 → 提升主要或次要版本號
 * 優化 UI、優化效能、優化小錯誤 → 更新錯誤版本號
 *
 * 檢查更新時，若主要或次要版本號變動，則顯示按鍵提示使用者更新
 * （參見 checkScriptUpdates()）
 */

// 觀察頁面是否進入或離開載入狀態（是否正在轉圈圈）
function observeLoadingOverlay() {
  // 頁面處於載入狀態時會出現的蓋版元素（俗稱「轉圈圈」）
  const loadingOverlay = $("#loading .loadingOverlay")[0];

  // 觀察 loadingOverlay 的 class attribute 是否變動
  new MutationObserver(mutations => {
    mutations.filter(m => m.attributeName === "class").forEach(m => {
      if (m.target.classList.contains("d-none")) {
        // 轉圈圈隱藏 => 已脫離載入狀態
        onPageLoaded();
      } else {
        // 顯示轉圈圈 => 正處於載入狀態
        onPageLoading();
      }
    });
  }).observe(loadingOverlay, { attributes: true });
}

// 頁面在載入狀態時進行此回呼
function onPageLoading() {
  console.log(`Page loading: ${document.location.href}`);
}

// 頁面離開載入狀態時進行此回呼
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

  // 匹配當前頁面 url 的樣式並進行對應的回呼
  urlPatternCallbackTable.forEach(({ pattern, callback }) => {
    if (currentUrl.match(pattern)) {
      // loadingOverlay 消失後，需要給點時間讓頁面的載入全部跑完
      setTimeout(callback, 100);
    }
  });
}

// 當「股市總覽」頁面已載入時進行的回呼
function onStockSummaryPageLoaded() {
  computeAssets();
  addJumpToPageForm(page => FlowRouter.go(`/company/${page}`));
}

// 當「公司資訊」頁面已載入時進行的回呼
function onCompanyDetailPageLoaded() {
  checkCompanyDetailFolderStates();
  addCompanyDetailFolderClickListeners();
}

// 當「帳號資訊」頁面已載入時進行的回呼
function onAccountInfoPageLoaded() {
  addTaxCalcFolder();   // 稅率資料夾
  detectOwnStockInfo(); // 持股資訊資料夾
}

// 當「新創計劃」頁面已載入時進行的回呼
function onFoundationPlanPageLoaded() {
  addAdditionalFoundationPlanInfo();
  addFoundationPlanSearchInputListener();
  addJumpToPageForm(page => FlowRouter.go(`/foundation/${page}`));
}

/**
 * 以非同步方式取得另外整理過的公司資料 json
 *
 * 考慮資料更新週期極長，若是已經取得過資料，就將之前取得的資料快取回傳
 *
 * 使用方法：
 * getJsonObj(jsonObj => {
 *   // 這裡的 jsonObj 即為該 json 物件
 * })
 */
const getJsonObj = (() => {
  // 先前取得的 json 快取
  let jsonObjCache = null;

  const jsonUrl = "https://jsonbin.org/abcd1357/ACGNstock-company";
  const request = new XMLHttpRequest();
  request.open("GET", jsonUrl); // 非同步 GET
  request.addEventListener("load", () => {
    console.log("got jsonObj");
    jsonObjCache = JSON.parse(request.responseText);
  });
  request.send();

  return (callback) => {
    // 若快取資料存在，則直接回傳快取
    if (jsonObjCache !== null) {
      callback(jsonObjCache);
      return;
    }

    // 若無快取資料，則加入事件監聽，等載入後再回傳資料
    request.addEventListener("load", function() {
      callback(jsonObjCache);
    });
  };
})();

// 新增按鈕至上面的導覽區
function addNavItems() {
  // 所有按鍵插入在原來的第三個按鍵（主題配置）之後
  // 按鍵需要以倒序插入，後加的按鍵會排在左邊
  const insertionTarget = $(".note")[2];

  // 「關於插件」按鍵
  $(`<li class="nav-item"><a class="nav-link" href="#" id="about-script">${t("aboutScript")}</a></li>`)
    .insertAfter(insertionTarget);
  $("#about-script").on("click", showAboutScript);

  // 「選擇語言」按鍵
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

  // 「關閉廣告」按鍵
  $(`<li class="nav-item"><a class="nav-link" href="#" id="block-ads">${t("blockAds")}</a></li>`)
    .insertAfter(insertionTarget);
  $("#block-ads").on("click", blockAds);
}

// 對所有廣告點擊關閉
function blockAds() {
  $(".fixed-bottom .media.bg-info.text.px-2.py-1.my-2.rounded .d-flex a").click();
}

/*************************************/
/************ 腳本更新檢查 *************/

// 腳本檢查更新的週期
const updateScriptCheckInterval = 600000; // 10 分鐘

// 檢查腳本是否有更新
function checkScriptUpdates() {
  checkGreasyForkScriptUpdate("33359"); // papago 版
  checkGreasyForkScriptUpdate("33781"); // Ming 版
  checkGreasyForkScriptUpdate("33814"); // frozenmouse 版

  // 在經過了一段時間之後，再檢查一次
  setTimeout(checkScriptUpdates, updateScriptCheckInterval);
}

// 檢查 GreasyFork 上特定 id 的腳本是否有更新
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
/************ 腳本更新檢查 *************/
/*************************************/

/************************************************/
/************ 股市總覽 stock summary *************/

function addJumpToPageForm(callback) {
  // 加入跳頁輸入框至分頁欄底下
  if ($("#jump-to-page-form").length === 0) {
    $("#main nav:eq(1)").append(`
      <form id="jump-to-page-form" class="form-inline justify-content-center" autocomplete="off">
        <div class="form-group">
          <div class="input-group">
            <span class="input-group-addon">跳至頁數</span>
            <input class="form-control" type="number" min="1" name="page"
              placeholder="請指定頁數…" maxlength="4" autocomplete="false"/>
            <span class="input-group-btn">
              <button class="btn btn-primary">
                走！
              </button>
            </span>
          </div>
        </div>
      </form>
    `);
    $("#jump-to-page-form").submit(() => {
      const page = parseInt($("#jump-to-page-form input[name=page]").val());
      if (page) callback(page);
      return false; // 避免系統預設的送出事件
    });
  }
  $("#jump-to-page-form input[name=page]").val(FlowRouter.current().params.page);
}

// 計算該頁面所持有的股票總額，並顯示在頁面上
function computeAssets() {
  let assets = 0; // 總資產

  // 是否在卡片模式
  const isInCardMode = $(".col-12.col-md-6.col-lg-4.col-xl-3").length > 0;

  // 取出每個公司的參考價格與持有數，加總到總資產
  if (isInCardMode) {
    $(".company-card").each((i, e) => {
      const price = Number(e.innerText.match(/\$ [0-9]+\(([0-9]+)\)/)[1]);
      const hold = Number(e.innerText.match(/([0-9]+).+%.+/)[1]);
      const subtotal = price * hold;
      console.log(`價=${price}, 持=${hold}, 總=${subtotal}`);
      assets += subtotal;
    });
  } else {
    $(".media-body.row.border-grid-body").each((i, e) => {
      const price = Number(e.innerText.match(/\$ [0-9]+\(([0-9]+)\)/)[1]);
      const hold = Number(e.innerText.match(/您在該公司持有([0-9]+)數量的股份/)[1]);
      const subtotal = price * hold;
      console.log(`價=${price}, 持=${hold}, 總=${subtotal}`);
      assets += subtotal;
    });
  }

  console.log("本頁持股價值: " + assets);

  // 顯示該頁面的持股總價值
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
/***********************************************/

/******************************************************/
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

// 資料夾開 / 關時的回呼
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

// 檢查所有資料夾的開關狀態
function checkCompanyDetailFolderStates() {
  setTimeout(() => {
    $(".d-block.h4").each((i, e) => {
      // 以資料夾圖示種類來判斷該資料夾是否已開啟
      const isFolderOpen = $(e).find("i").hasClass("fa-folder-open");
      const folderName = companyDetailFolderNames[i];

      // 根據資料夾開關或關來呼叫對應的回呼，未定義則略過
      const definedFolderCallbacks = companyDetailFolderCallbacks[folderName];
      if (definedFolderCallbacks !== undefined) {
        const callback = definedFolderCallbacks[isFolderOpen ? "open" : "close"];
        if (callback !== undefined) callback();
      }
    });
  }, 0); // 給點時間時等待更新後再 check
}

// 監聽資料夾的 click 事件，當發生時檢查狀態
function addCompanyDetailFolderClickListeners() {
  $(".d-block.h4")
    .off("click", checkCompanyDetailFolderStates) // 避免重複加入事件
    .on("click", checkCompanyDetailFolderStates);
}

// 計算每股盈餘、本益比、益本比並顯示
function addAdditionalNumbersData() {
  // 先移除之前新增的資訊
  removeAdditionalNumbersInfo();

  const dataValueCells = $(".col-8.col-md-4.col-lg-2.text-right.border-grid");  // 「數據資訊」的表格欄位

  const stockPrice = Number(dataValueCells[0].innerHTML.match(/[0-9]+/)); // 參考價格
  const revenue = Number(dataValueCells[3].innerHTML.match(/[0-9]+/));    // 本季營利
  const totalStock = Number(dataValueCells[4].innerHTML.match(/[0-9]+/)); // 總釋股量

  const earnPerShare = 0.8075 * revenue / totalStock;                         // 每股盈餘
  const PERatio = earnPerShare === 0 ? Infinity : stockPrice / earnPerShare;  // 本益比
  const benefitRatio = earnPerShare / stockPrice;                             // 益本比

  // 增加表格欄位
  function appendDataValueCell(id, name, value) {
    $("[data-toggle-panel=numbers]").parent().nextUntil(".col-12.border-grid").last()
      .after(`
        <div id="${id}" class="col-4 col-md-2 col-lg-2 text-right border-grid">${name}</div>
        <div id="${id}-value" class="col-8 col-md-4 col-lg-2 text-right border-grid">${value}</div>
      `);
  }

  appendDataValueCell("earn-per-share", dict[currentLanguage].earnPerShare, earnPerShare.toFixed(2));
  appendDataValueCell("pe-ratio", dict[currentLanguage].PERatio, PERatio === Infinity ? "∞" : PERatio.toFixed(2));
  appendDataValueCell("benefit-ratio", dict[currentLanguage].benefitRatio, benefitRatio.toFixed(2));
  console.log("addSomeInfo!!");
}

// 清除先前額外新增的資訊
function removeAdditionalNumbersInfo() {
  $("#earn-per-share, #earn-per-share-value, #pe-ratio, #pe-ratio-value, #benefit-ratio, #benefit-ratio-value").remove();
}

/************** 公司資訊 company detail ****************/
/******************************************************/

/************************************************/
/************ 帳號資訊 account info **************/

// 計算持股資訊與金額試算
function detectOwnStockInfo() {
  // TODO 此函式需要重整，將計算邏輯和 UI 分開

  const ownStockList = $("[data-toggle-panel=stock]").parent().next().children().filter((i, e) => e.innerHTML.match(/擁有.+公司的.+股票/));
  if (ownStockList.length === 0) return;  // 持股資訊未開啟或是無資料

  // 「計算此頁資產」按鍵
  if ($("#compute-btn").length === 0) {
    $(`<button class="btn btn-danger btn-sm" type="button" id="compute-btn">計算此頁資產</button>`)
      .on("click", detectOwnStockInfo)
      .insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  // 「清除總資產訊息」按鍵
  if ($("#clear-asset-message-btn").length === 0) {
    $(`<button class="btn btn-danger btn-sm" type="button" id="clear-asset-message-btn">清除總資產訊息</button>`)
      .on("click", () => $("#asset-display-div").remove())
      .insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  // 總資產訊息顯示區
  if ($("#asset-display-div").length === 0) {
    $(`
      <div id="asset-display-div">
        <p>公司股價更新時間為：<span id="asset-display-json-update-time">???</span></p>
        <p>目前共有 <span id="total-asset">0</span> 元資產</p>
      </div>
    `).insertAfter($("[data-toggle-panel=stock]").parent().next().children().last());
  }

  getJsonObj(jsonObj => {
    $("#asset-display-json-update-time").html(jsonObj.updateTime);

    let total = 0;
    ownStockList.each((i, e) => {
      const companyLinkMatchResult = e.innerHTML.match(/href="([^"]+)/);
      if (!companyLinkMatchResult) return;

      const companyData = jsonObj.companys.find(c => c.companyLink === companyLinkMatchResult[1]);
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
  });
}

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

  // 資料夾的開關事件
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
/************************************************/

/************************************************/
/************ 新創計劃 foundation plan ***********/

// 從總投資額推算新創公司的預計股價
function computeStockPriceFromTotalFund(totalFund) {
  let result = 1;
  while (totalFund / 1000 > result) result *= 2;
  return Math.max(1, result / 2);
}

// 計算新創公司的額外資訊
function computeAdditionalFoundationPlanInfo(i, inCardMode) {
  // 個人投資額
  const personalFund = Number(
    inCardMode
      ? $(".company-card-mask")[i].children[6].innerText.match(/[0-9]+/)[0]
      : ($(`.media-body.row.border-grid-body:eq(${i}) .mb-1`)[0].innerText.match(/[0-9]+/) || [0])[0]
  );

  // 總投資額
  const totalFund = Number(
    inCardMode
      ? $(".company-card-mask")[i].children[5].innerText.match(/[0-9]+/)[0]
      : $(`.media-body.row.border-grid-body:eq(${i}) .col-8.col-lg-3.text-right.border-grid:eq(3)`)[0].innerText.match(/[0-9]+/)[0]
  );

  const stockPrice = computeStockPriceFromTotalFund(totalFund);   // 預計股價
  const stockAmount = personalFund / stockPrice;                  // 預計持股
  const stockRight = personalFund / totalFund;                    // 預計股權
  return { stockPrice, stockAmount, stockRight };
}

// 計算該頁面新創公司的額外資訊並顯示
function addAdditionalFoundationPlanInfo() {
  const displayModeIcon = $(".btn.btn-secondary.mr-1 i");
  const inCardMode = displayModeIcon.hasClass("fa-th");   // 是否以卡片模式顯示

  const companies = $(inCardMode ? ".company-card-mask" : ".media-body.row.border-grid-body");
  companies.each((i, e) => {
    if ($(e).find("div[name=foundationPlanNewInfo]").length !== 0) return; // 已加入過資訊就略過

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

// 監聽新創計劃搜尋欄的輸入
function addFoundationPlanSearchInputListener() {
  // 既有公司搜尋提示
  $(".form-control")
    .off("input", listExistingCompanies)  // 避免重複加入事件
    .on("input", listExistingCompanies);
}

// 找尋並顯示在 jsonObj 裡已建檔的公司名冊
function listExistingCompanies() {
  $("#displayResult").remove(); // 移除舊有資料

  const searchString = $(".form-control").val();
  if (!searchString) return;  // 略過空資料

  const searchRegExp = new RegExp(searchString, "i"); // ignore case

  getJsonObj(jsonObj => {
    // 找出名稱或 tag 符合的公司並顯示
    const matchedCompanies = jsonObj.companys.filter(c => searchRegExp.test(c.companyName) || searchRegExp.test(c.companyTags));  // WTF is companys!?

    $(`
      <div id="displayResult" style="display: block; height: 100px; margin-top: 16px; overflow: scroll; overflow-x: hidden;">
        <p>公司名冊更新於 ${jsonObj.updateTime}</p>
        <p>${matchedCompanies.map(c => `<a href="${c.companyLink}">${c.companyName}</a>`).join(", ")}</p>
      </div>
    `).insertAfter($(".form-inline"));
  });
}
/************ 新創計劃 foundation plan ***********/
/************************************************/

/***************************************/
/************** 關於插件 ****************/

// 顯示插件資訊
function showAboutScript() {
  // （暴力地）移除目前頁面的顯示資訊…
  $(".card-block").remove();

  // …並改成顯示插件資訊
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

  // 「更新記錄」資料夾
  const releaseHistoryFolder = $("#release-history-folder");
  releaseHistoryFolder.on("click", () => {
    const releaseHistoryFolderIcon = releaseHistoryFolder.find(".fa");
    if (releaseHistoryFolderIcon.hasClass("fa-folder")) {
      // 資料夾打開，顯示更新記錄
      releaseHistoryFolderIcon.removeClass("fa-folder").addClass("fa-folder-open");
      releaseHistoryFolder.after((releaseHistoryList.map(({ version, description }) => createReleaseHistoryDiv(version, description)).join("")));
    } else {
      // 資料夾關閉，移除更新記錄
      releaseHistoryFolderIcon.removeClass("fa-folder-open").addClass("fa-folder");
      releaseHistoryFolder.nextAll(".col-12.border-grid").remove();
    }
  });
}

// 更新紀錄列表
const releaseHistoryList = [
  {
    version: "2.810",
    description: `<p><span class="text-info">股市總覽</span>與<span class="text-info">新創計劃</span>增加了跳頁功能，可直接跳至指定頁數。</p>`,
  },
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

// 建立對應版本的更新說明
function createReleaseHistoryDiv(version, description) {
  return `
    <div class="col-12 border-grid">
      <h4>版本${version}：</h4>
      ${description}
    </div>
  `;
}
/************** 關於插件 ****************/
/***************************************/

/**************************************/
/************* 語言相關 ****************/

// 目前的語言
let currentLanguage = window.localStorage.getItem("PM_language") || "tw";

// 切換顯示語言
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

// 翻譯表
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
/************* 語言相關 ****************/
/**************************************/

// 程式進入點
(function() {
  observeLoadingOverlay();
  setTimeout(addNavItems, 0);
  setTimeout(checkScriptUpdates, 0);
})();
