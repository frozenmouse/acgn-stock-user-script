// ==UserScript==
// @name         ACGN股票系統每股營利外掛
// @namespace    http://tampermonkey.net/
// @version      3.201
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

const {dbVariables} = require("./db/dbVariables");
const {dbCompanies} = require("./db/dbCompanies");
const {dbDirectors} = require("./db/dbDirectors");

// 判斷直到 condition 符合之後再執行 action
function waitUntil(condition, action) {
  setTimeout(function check() {
    if (condition()) {
      action();
    } else {
      setTimeout(check, 0);
    }
  }, 0);
}

// 用公司資訊算出 EPS 與本益比
function computeEpsAndPeRatio({totalRelease, profit, listPrice}) {
  const eps = profit * 0.8 / totalRelease;
  const peRatio = listPrice / eps;
  return {eps, peRatio};
}

// 取得 Template 的 helpers
Template.prototype.getHelper = function(name) {
  return this.__helpers[` ${name}`];
};

// 包裝 Template 的 onRendered，加入自訂動作
Template.prototype.oldOnRendered = Template.prototype.onRendered;
Template.prototype.onRendered = function(callback) {
  // 在添加 onRendered callback 時一併記錄起來
  this.customOnRenderedCallbacks = this.customOnRenderedCallbacks || [];
  this.customOnRenderedCallbacks.push(callback);

  // 在真正執行到 callback 之後記錄起來
  this.oldOnRendered(() => {
    const instance = Template.instance();
    callback();
    instance.customOnRenderedCalled = true;
  });
};

// 有分頁顯示時，插入跳頁表單
Template.pagination.onRendered(() => {
  const targetPageVar = new ReactiveVar();
  const instance = Template.instance();
  const jumpToPageForm = $(`
    <form id="jump-to-page-form" class="form-inline justify-content-center" autocomplete="off">
      <div class="form-group">
        <div class="input-group">
          <span class="input-group-addon">跳至頁數</span>
          <input class="form-control" type="number" min="1" name="page"
            placeholder="請指定頁數…" maxlength="4" autocomplete="off"/>
          <span class="input-group-btn">
            <button class="btn btn-primary">
              走！
            </button>
          </span>
        </div>
      </div>
    </form>
  `);

  // 表單送出 -> 設定 targetPageVar
  jumpToPageForm.submit(() => {
    const targetPage = Number(jumpToPageForm.find("input[name=page]").val());
    targetPageVar.set(targetPage);
    return false; // 避免系統預設的送出事件
  });

  // 接收 targetPageVar -> 跳頁或設定 data.offset
  instance.autorun(() => {
    const data = Template.currentData();
    const totalCount = dbVariables.get(data.useVariableForTotalCount);
    const totalPages = Math.ceil(totalCount / data.dataNumberPerPage);

    // 目標頁面不超過上下限
    const targetPage = Math.max(1, Math.min(targetPageVar.get(), totalPages));
    targetPageVar.set(undefined); // 清空上次表單送出的頁數

    if (!targetPage) return;

    if (data.useHrefRoute) {
      FlowRouter.go(FlowRouter.path(FlowRouter.getRouteName(), {page: targetPage}));
    } else {
      data.offset.set((targetPage - 1) * data.dataNumberPerPage);
    }
  });

  // 接收 data -> 處理表單顯示
  instance.autorun(() => {
    const data = Template.currentData();
    const totalCount = dbVariables.get(data.useVariableForTotalCount);
    const totalPages = Math.ceil(totalCount / data.dataNumberPerPage);
    const haveData = Template.pagination.getHelper("haveData").bind(data);
    const pages = Template.pagination.getHelper("pages").bind(data);
    const pageItemClass = Template.pagination.getHelper("pageItemClass").bind(data);

    if (haveData()) {
      // 分頁條目前選擇的頁面
      const activePage = pages().find(p => /active/.test(pageItemClass(p)));

      jumpToPageForm.find("input[name=page]")
        .val(activePage)
        .attr("max", totalPages);

      // nav 不會馬上出現，需要延後
      waitUntil(
        () => instance.$("nav").length > 0,
        () => instance.$("nav").append(jumpToPageForm));
    }
  });
});

// 附加顯示每股營利、本益比、益本比在數據資訊
Template.companyDetailTable.onRendered(() => {
  const instance = Template.instance();
  const isDisplayPanel = Template.companyDetailTable.getHelper("isDisplayPanel");

  const dataCellsSample = $(`
    <div class="col-4 col-md-2 col-lg-2 text-right border-grid"/>
    <div class="col-8 col-md-4 col-lg-2 text-right border-grid"/>
  `);

  const epsDataCells = dataCellsSample.clone();
  epsDataCells.filter("div:eq(0)").html(t("earnPerShare"));

  const peRatioCells = dataCellsSample.clone();
  peRatioCells.filter("div:eq(0)").html(t("PERatio"));

  const epRatioCells = dataCellsSample.clone();
  epRatioCells.filter("div:eq(0)").html(t("benefitRatio"));

  const additionalDataList = [epsDataCells, peRatioCells, epRatioCells];

  instance.autorun(() => {
    const companyId = FlowRouter.getParam("companyId");
    const companyData = dbCompanies.findOne({_id: companyId});
    if (!companyData) return;

    const {eps, peRatio} = computeEpsAndPeRatio(companyData);
    epsDataCells.filter("div:eq(1)").html(`$ ${eps.toFixed(2)}`);
    peRatioCells.filter("div:eq(1)").html(isFinite(peRatio) ? peRatio.toFixed(2) : "∞");
    epRatioCells.filter("div:eq(1)").html((1 / peRatio).toFixed(2));

    if (isDisplayPanel("numbers")) {
      setTimeout(() => {
        additionalDataList.forEach(e => {
          // 附加在數據資訊展開後的最後一個元素後面
          instance.$("[data-toggle-panel=numbers]")
            .parent().nextUntil(".col-12").last()
            .after(e);
        });
      }, 0);
    } else {
      additionalDataList.forEach(e => e.detach());
    }

    console.log(`numbers panel opened: ${isDisplayPanel("numbers")}`);
  });
});

// 計算該頁面所持有的股票總額並顯示
Template.companyList.onRendered(() => {
  const totalAssetsDisplay = $(`
    <div class="media company-summary-item border-grid-body">
      <div class="col-6 text-right border-grid">
        <h2>${t("totalAssetsInThisPage")}</h2>
      </div>
      <div class="col-6 text-right border-grid">
        <h2 id="total-assets-result"></h2>
      </div>
    </div>
  `);

  const instance = Template.instance();
  instance.autorun(() => {
    const ownStocks = dbDirectors.find({ userId: Meteor.userId() }).fetch();
    const companies = dbCompanies.find().fetch().reduce((obj, c) => Object.assign(obj, {[c._id]: c}), {});
    const totalAssets = ownStocks.filter(({companyId}) => companies[companyId])
      .reduce((sum, {companyId, stocks}) => sum + companies[companyId].listPrice * stocks, 0);
    console.log(`totalAssets = ${totalAssets}`);

    instance.$(".card-title.mb-1").after(totalAssetsDisplay);
    totalAssetsDisplay.find("#total-assets-result").html(`$ ${totalAssets}`);
  });
});

// 增加更多資訊在股市總覽的公司卡片上
Template.companyListCard.onRendered(() => {
  function insertAfterLastRow(row) {
    instance.$(".row-info").last().after(row);
  }

  function hideRow(row) {
    row.removeClass("d-flex").addClass("d-none");
  }

  function showRow(row) {
    row.removeClass("d-none").addClass("d-flex");
  }

  const instance = Template.instance();
  const getStockAmount = Template.companyListCard.getHelper("getStockAmount");
  const infoRowSample = instance.$(".row-info").last();

  const ownValueRow = infoRowSample.clone();
  ownValueRow.find("p:eq(0)").html("持有總值");
  insertAfterLastRow(ownValueRow);

  const profitRow = infoRowSample.clone();
  profitRow.find("p:eq(0)").html("本季營利");
  insertAfterLastRow(profitRow);

  const peRatioRow = infoRowSample.clone();
  peRatioRow.find("p:eq(0)").html("本益比");
  insertAfterLastRow(peRatioRow);

  const peRatioInverseRow = infoRowSample.clone();
  peRatioInverseRow.find("p:eq(0)").html("益本比");
  insertAfterLastRow(peRatioInverseRow);

  const dividendRow = infoRowSample.clone();
  dividendRow.find("p:eq(0)").html("預計分紅");
  insertAfterLastRow(dividendRow);

  const managerSalaryRow = infoRowSample.clone();
  managerSalaryRow.find("p:eq(0)").html("經理薪水");
  insertAfterLastRow(managerSalaryRow);

  instance.autorun(() => {
    const companyData = Template.currentData();
    const {_id: companyId, profit, totalRelease, listPrice, manager} = companyData;
    const {peRatio} = computeEpsAndPeRatio(companyData);

    profitRow.find("p:eq(1)").html(`$ ${profit}`);
    peRatioRow.find("p:eq(1)").html(isFinite(peRatio) ? peRatio.toFixed(2) : "∞");
    peRatioInverseRow.find("p:eq(1)").html((1 / peRatio).toFixed(2));

    if (!Meteor.user()) {
      hideRow(ownValueRow);
      hideRow(dividendRow);
      hideRow(managerSalaryRow);
    } else {
      const stockAmount = getStockAmount(companyId);
      const ownValue = stockAmount * listPrice;
      ownValueRow.find("p:eq(1)").html(`$ ${ownValue}`);
      showRow(ownValueRow);

      const dividend = Math.round(profit * 0.8 * stockAmount / totalRelease);
      dividendRow.find("p:eq(1)").html(`$ ${dividend}`);
      showRow(dividendRow);

      if (Meteor.userId() !== manager) {
        hideRow(managerSalaryRow);
      } else {
        const managerSalary = Math.round(profit * 0.05);
        managerSalaryRow.find("p:eq(1)").html(`$ ${managerSalary}`);
        showRow(managerSalaryRow);
      }
    }
  });
});

/************************************************/
/************ 帳號資訊 account info **************/

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

// 控制稅金試算資料夾是否展開的 ReactiveVar
const taxCalcFolderExpandedVar = new ReactiveVar(false);

// 加入稅金試算資料夾
Template.accountInfo.onRendered(() => {
  console.log("accountInfo.onRendered()");
  const instance = Template.instance();

  const taxCalcFolderHead = $(`
    <div class="col-12 border-grid">
      <a class="d-block h4" href="" data-toggle-panel="tax-calc">
        ${t("taxCalculation")} <i class="fa fa-folder"/>
      </a>
    </div>
  `);
  const taxCalcFolderIcon = taxCalcFolderHead.find("i.fa");
  const taxCalcFolderBody = $(`
    <div class="col-12 text-right border-grid">
      <h5>${t("enterTotalAssets")}</h5>
      <input class="form-control" type="number">
      <h5>${t("yourTax")} <span id="tax-calc-output">$ 0</span></h5>
    </div>
  `);
  const taxCalcInput = taxCalcFolderBody.find("input");
  const taxCalcOutput = taxCalcFolderBody.find("span#tax-calc-output");

  taxCalcInput.on("input", () => {
    const input = Number(taxCalcInput.val().match(/[0-9]+/));
    const { rate, adjustment } = taxRateTable.find(e => input < e.asset);
    const output = Math.ceil(input * rate - adjustment);
    taxCalcOutput.text(`$ ${output}`);
  });

  waitUntil(
    () => instance.$(".card-block:last() .row").length > 0,
    () => instance.$(".card-block:last() .row").append(taxCalcFolderHead));

  instance.autorun(() => {
    const taxCalcFolderExpanded = taxCalcFolderExpandedVar.get();

    if (taxCalcFolderExpanded) {
      setTimeout(() => {
        taxCalcFolderIcon.addClass("fa-folder-open").removeClass("fa-folder");
        taxCalcFolderBody.insertAfter(taxCalcFolderHead);
      }, 0);
    } else {
      setTimeout(() => {
        taxCalcFolderIcon.addClass("fa-folder").removeClass("fa-folder-open");
        taxCalcFolderBody.detach();
      });
    }
  });
});

Template.accountInfo.events({
  "click [data-toggle-panel=tax-calc]"(event) {
    event.preventDefault();
    console.log("test");
    taxCalcFolderExpandedVar.set(!taxCalcFolderExpandedVar.get());
  },
});

// 在新創列表加入預計股價、個人股權資訊
Template.foundationListCard.onRendered(() => {
  function insertAfterLastRow(row) {
    instance.$(".row-info").last().after(row);
  }

  const instance = Template.instance();

  const infoRowSample = instance.$(".row-info").last();

  const stockPriceRow = infoRowSample.clone();
  stockPriceRow.find("p:eq(0)").html(t("foundationPlanStockPrice"));
  insertAfterLastRow(stockPriceRow);

  const personalStockAmountRow = infoRowSample.clone();
  personalStockAmountRow.find("p:eq(0)").html(t("foundationPlanShare"));
  insertAfterLastRow(personalStockAmountRow);

  const personalStockRightRow = infoRowSample.clone();
  personalStockRightRow.find("p:eq(0)").html(t("foundationPlanStock"));
  insertAfterLastRow(personalStockRightRow);

  instance.autorun(() => {
    const foundationData = Template.currentData();
    const totalFund = foundationData.invest.reduce((sum, {amount}) => sum + amount, 0);
    const stockPrice = computeStockPriceFromTotalFund(totalFund);

    const currentUserId = Meteor.userId();
    const personalInvest = foundationData.invest.find(i => i.userId === currentUserId);
    const personalFund = personalInvest ? personalInvest.amount : 0;
    const personalStockAmount = Math.floor(personalFund / stockPrice);
    const personalStockRight = personalFund / totalFund;

    stockPriceRow.find("p:eq(1)").html(`$ ${stockPrice}`);
    personalStockAmountRow.find("p:eq(1)").html(`${personalStockAmount} 股`);
    personalStockRightRow.find("p:eq(1)").html(`${(personalStockRight * 100).toFixed(2)} %`);
  });
});

// 從總投資額推算新創公司的預計股價
function computeStockPriceFromTotalFund(totalFund) {
  let result = 1;
  while (totalFund / 1000 > result) result *= 2;
  return Math.max(1, result / 2);
}

// 新增插件功能按鈕至上面的導覽區
function addPluginDropdownMenu() {
  // 所有按鍵插入在原來的第三個按鍵（主題配置）之後
  // 按鍵需要以倒序插入，後加的按鍵會排在左邊
  const insertionTarget = $(".note")[2];

  const pluginDropdown = $(`
    <div class="note">
      <li class="nav-item dropdown">
        <a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown">${t("pluginDropdown")}</a>
        <div class="dropdown-menu px-3" aria-labelledby="navbarDropdownMenuLink" style="display: none;" id="lang-menu">
          <a class="nav-link" href="#" id="block-ads">${t("blockAds")}</a>
          <h6 class="dropdown-header" style="padding: 0.5rem 0rem">${t("language")}</h6>
          <a class="nav-link" href="#" id="lang-tw">台灣話</a>
          <a class="nav-link" href="#" id="lang-marstw">ㄏㄒㄨ</a>
          <a class="nav-link" href="#" id="lang-en">English</a>
          <a class="nav-link" href="#" id="lang-jp">日本語</a>
          <div class="dropdown-divider"/>
          <a class="nav-link" href="#" id="about-script">${t("aboutScript")}</a>
        </div>
      </li>
    </div>
  `);
  pluginDropdown.insertAfter(insertionTarget);
  pluginDropdown.find("#lang-tw").on("click", () => { changeLanguage("tw"); });
  pluginDropdown.find("#lang-marstw").on("click", () => { changeLanguage("marstw"); });
  pluginDropdown.find("#lang-en").on("click", () => { changeLanguage("en"); });
  pluginDropdown.find("#lang-jp").on("click", () => { changeLanguage("jp"); });
  pluginDropdown.find("#about-script").on("click", showAboutScript);
  pluginDropdown.find("#block-ads").on("click", blockAds);
}

// 對所有廣告點擊關閉
function blockAds() {
  $(".fixed-bottom a.btn").click();
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

// 將版本號字串拆解成 major, minor, patch
function parseVersion(versionString) {
  const [head, rest] = versionString.split(".");
  const major = Number.parseInt(head);
  const minor = Number.parseInt(rest.substring(0, 1));
  const patch = Number.parseInt(rest.substring(1));
  return {major, minor, patch};
}

// 檢查 GreasyFork 上特定 id 的腳本是否有更新
function checkGreasyForkScriptUpdate(id) {
  const scriptUrl = `https://greasyfork.org/zh-TW/scripts/${id}`;
  const request = new XMLHttpRequest();

  request.open("GET", `${scriptUrl}.json`);
  request.addEventListener("load", function() {
    const remoteVersion = parseVersion(JSON.parse(this.responseText).version);
    const localVersion = parseVersion(GM_info.script.version);

    console.log(`檢查 GreasyFork 腳本版本：id = ${id}, remoteVersion = ${JSON.stringify(remoteVersion)}, localVersion = ${JSON.stringify(localVersion)}`);

    // 只有 major 或 minor 變動才通知更新
    const isUpdateNeeded = remoteVersion.major > localVersion.major
      || (remoteVersion.major === localVersion.major && remoteVersion.minor > localVersion.minor);

    if (isUpdateNeeded && $(`#update-script-button-greasy-${id}`).length === 0) {
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
        <p><a href="https://greasyfork.org/zh-TW/scripts/33814" target="_blank">更新插件</a></p>
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
    version: "3.000",
    description: `
      <p>幾乎全部打掉重練，使用更有效率的方式與頁面結合。</p>
      <p><span class="text-info">股市總覽</span>新增顯示個股持有總值、本季營利、本益比、預計分紅、與經理薪水。</p>
      <p><span class="text-info">帳號資訊</span>移除統計分紅功能，請使用<a href="https://greasyfork.org/zh-TW/scripts/33542">ACGN-stock營利統計外掛 by SoftwareSing</a>。</p>
      <p><span class="text-info">新創計畫</span>暫時移除搜尋已存在公司功能（未來想辦法加回）。</p>
    `,
  },
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
    pluginDropdown: "papago插件",
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
    pluginDropdown: "papago Plugin",
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
    pluginDropdown: "papago プラグイン",
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
    pluginDropdown: "%%狗ㄉ外掛",
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

function findAncestorViews(view) {
  if (!view.parentView) return [];

  const ancestorViews = [];
  let ancestorView = view.parentView;
  while (ancestorView) {
    ancestorViews.push(ancestorView);
    ancestorView = ancestorView.parentView;
  }
  return ancestorViews;
}

// 手動觸發新加入的 onRendered
function manuallyTriggerCustomOnRendered() {
  function check() {
    $("*").toArray()
      .map(e => Blaze.getView(e))
      .flatMap(v => v ? [v, ...findAncestorViews(v)] : [])
      .forEach(view => {
        if (!view || !view.templateInstance) return;

        const instance = view.templateInstance();
        const callbacks = view.template.customOnRenderedCallbacks || [];

        if (callbacks.length === 0 || instance.customOnRenderedCalled) return;

        console.log("call custom onRendered", instance);
        callbacks.forEach(callback => Template._withTemplateInstanceFunc(view.templateInstance, callback));
        instance.customOnRenderedCalled = true;
      });
  }

  const loopInterval = 500;
  const loopLimit = 5;
  let loopCount = 0;

  check();
  const intervalHandle = setInterval(() => {
    check();
    loopCount++;
    if (loopCount > loopLimit) {
      clearInterval(intervalHandle);
    }
  } , loopInterval);
}

// ======= 主程式 =======
(function() {
  manuallyTriggerCustomOnRendered();
  addPluginDropdownMenu();
  checkScriptUpdates();
})();
