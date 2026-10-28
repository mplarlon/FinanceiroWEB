import React, { useState } from "react";
import CharlieLeads from "./CharlieLeads.jsx";
import EcommerceIntelligence from "./EcommerceIntelligence.jsx";
import CharlieSalesDashboard from "./CharlieSalesDashboard.jsx";
import CharlieMarketplaceBooster from "./CharlieMarketplaceBooster.jsx";
import CharlieSalesHunter from "./CharlieSalesHunter.jsx";
import CharlieWhatsAppSales from "./CharlieWhatsAppSales.jsx";
import CharlieSmartQuotes from "./CharlieSmartQuotes.jsx";
import CharlieRecovery from "./CharlieRecovery.jsx";
import CharliePriceIntelligence from "./CharliePriceIntelligence.jsx";
import CharlieCompetitorRadar from "./CharlieCompetitorRadar.jsx";
import CharlieRebuy from "./CharlieRebuy.jsx";
import CharlieStockGuardian from "./CharlieStockGuardian.jsx";
import CharlieSmartCampaigns from "./CharlieSmartCampaigns.jsx";
import CharlieAutopilot from "./CharlieAutopilot.jsx";
import CharlieProductMatch from "./CharlieProductMatch.jsx";
import CharlieBuyingSignals from "./CharlieBuyingSignals.jsx";
import CharlieSmartPurchasing from "./CharlieSmartPurchasing.jsx";
import CharlieSalesCoach from "./CharlieSalesCoach.jsx";
import CharlieGoogleShopping from "./CharlieGoogleShopping.jsx";
import CharlieSeo from "./CharlieSeo.jsx";
import CharlieKitBuilder from "./CharlieKitBuilder.jsx";
import CharlieProfitTracker from "./CharlieProfitTracker.jsx";
import CharlieCustomer360 from "./CharlieCustomer360.jsx";
import CharlieSalesMission from "./CharlieSalesMission.jsx";
import CharlieAutomationCenter from "./CharlieAutomationCenter.jsx";
import { PlannedModule, SalesAlerts, SalesAudit, SalesPermissions } from "./CharlieSalesPanels.jsx";
import { SALES_MENU, SALES_SECTION_KEY, findSalesMenuItem, normalizeSalesSection } from "../lib/charlie-sales-ecosystem.js";

const SALES_NAV_HIDDEN_KEY = "charlie-sales-nav-hidden";

function readSection() {
  try { return normalizeSalesSection(localStorage.getItem(SALES_SECTION_KEY)); }
  catch { return "dashboard"; }
}

function readMenuHidden() {
  try { return localStorage.getItem(SALES_NAV_HIDDEN_KEY) === "1"; }
  catch { return false; }
}

export default function CharlieSalesShell({ connected, onSynchronized, children }) {
  const [section, setSection] = useState(readSection);
  const [menuHidden, setMenuHidden] = useState(readMenuHidden);
  const current = findSalesMenuItem(section) || findSalesMenuItem("dashboard");
  const visibleGroup = SALES_MENU.find((group) => group.id === current.groupId) || SALES_MENU[0];

  function open(id) {
    const next = normalizeSalesSection(id);
    setSection(next);
    try { localStorage.setItem(SALES_SECTION_KEY, next); } catch { /* o navegador pode bloquear o armazenamento local */ }
  }

  function openGroup(group) {
    if (group.id === current.groupId) return;
    open(group.items[0]?.id);
  }

  function toggleMenu() {
    setMenuHidden((currentHidden) => {
      const next = !currentHidden;
      try { localStorage.setItem(SALES_NAV_HIDDEN_KEY, next ? "1" : "0"); } catch { /* o navegador pode bloquear o armazenamento local */ }
      return next;
    });
  }

  let content = null;
  if (current.kind === "dashboard") content = <CharlieSalesDashboard connected={connected} onSynchronized={onSynchronized} />;
  else if (current.kind === "intelligence") content = <EcommerceIntelligence key={current.id} connected={connected} onSynchronized={onSynchronized} initialSection={current.section || "dashboard"} banner={current.note || ""} />;
  else if (current.kind === "store") content = <div className="charlie-sales-store">{children}</div>;
  else if (current.kind === "leads") content = <CharlieLeads />;
  else if (current.kind === "booster") content = <CharlieMarketplaceBooster connected={connected} />;
  else if (current.kind === "hunter") content = <CharlieSalesHunter onOpen={open} />;
  else if (current.kind === "whatsapp") content = <CharlieWhatsAppSales />;
  else if (current.kind === "quotes") content = <CharlieSmartQuotes />;
  else if (current.kind === "recovery") content = <CharlieRecovery onOpen={open} />;
  else if (current.kind === "prices") content = <CharliePriceIntelligence />;
  else if (current.kind === "radar") content = <CharlieCompetitorRadar />;
  else if (current.kind === "rebuy") content = <CharlieRebuy />;
  else if (current.kind === "stock") content = <CharlieStockGuardian />;
  else if (current.kind === "campaigns") content = <CharlieSmartCampaigns />;
  else if (current.kind === "autopilot") content = <CharlieAutopilot />;
  else if (current.kind === "match") content = <CharlieProductMatch />;
  else if (current.kind === "signals") content = <CharlieBuyingSignals />;
  else if (current.kind === "purchasing") content = <CharlieSmartPurchasing />;
  else if (current.kind === "coach") content = <CharlieSalesCoach />;
  else if (current.kind === "shopping") content = <CharlieGoogleShopping />;
  else if (current.kind === "seo") content = <CharlieSeo />;
  else if (current.kind === "kits") content = <CharlieKitBuilder />;
  else if (current.kind === "lucro") content = <CharlieProfitTracker onOpen={open} />;
  else if (current.kind === "customer360") content = <CharlieCustomer360 />;
  else if (current.kind === "mission") content = <CharlieSalesMission />;
  else if (current.kind === "automations") content = <CharlieAutomationCenter />;
  else if (current.kind === "alerts") content = <SalesAlerts />;
  else if (current.kind === "permissions") content = <SalesPermissions />;
  else if (current.kind === "audit") content = <SalesAudit />;
  else content = <PlannedModule item={current} onOpen={open} />;

  return <div className={`charlie-sales${menuHidden ? " menu-oculto" : ""}`}>
    {menuHidden ? (
      <button type="button" className="charlie-sales-nav-toggle" aria-expanded="false" onClick={toggleMenu}>
        Mostrar menu
      </button>
    ) : (
      <nav id="charlie-sales-nav" className="charlie-sales-nav" aria-label="Módulos de vendas">
        <div className="charlie-sales-tabs" role="tablist">
          {SALES_MENU.map((group) => <button type="button" role="tab" key={group.id} className={group.id === visibleGroup.id ? "ativo" : ""} aria-selected={group.id === visibleGroup.id} onClick={() => openGroup(group)}>
            {group.label}
          </button>)}
        </div>
        <div className="charlie-sales-links" role="tabpanel">
          {visibleGroup.items.map((item) => <button type="button" key={item.id} className={item.id === current.id ? "ativo" : ""} aria-current={item.id === current.id ? "page" : undefined} onClick={() => open(item.id)}>
            {item.label}
            {item.kind === "planned" ? <small>Etapa {item.stage}</small> : null}
          </button>)}
          <button type="button" className="charlie-sales-nav-toggle" aria-expanded="true" aria-controls="charlie-sales-nav" onClick={toggleMenu}>
            Ocultar
          </button>
        </div>
      </nav>
    )}
    <div className="charlie-sales-main">{content}</div>
  </div>;
}
