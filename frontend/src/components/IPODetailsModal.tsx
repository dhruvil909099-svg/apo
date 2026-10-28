import React, { useState } from 'react';
import {
  X, Building2, Calendar, FileText, CheckCircle2,
  TrendingUp, ExternalLink, ShieldAlert,
  Target, BarChart3, ChevronRight, Layers, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { IPO } from '../types';

interface IPODetailsModalProps {
  ipo: IPO | null;
  isOpen: boolean;
  onClose: () => void;
  onApply: (ipo: IPO) => void;
}

type TabSection = 'OVERVIEW' | 'TIMELINE' | 'FINANCIALS' | 'VALUATION' | 'SUBSCRIPTION' | 'RISKS' | 'DOCUMENTS';

export const IPODetailsModal: React.FC<IPODetailsModalProps> = ({
  ipo,
  isOpen,
  onClose,
  onApply
}) => {
  const [activeSection, setActiveSection] = useState<TabSection>('OVERVIEW');

  if (!isOpen || !ipo) return null;

  const minInv = ipo.min_investment || ((ipo.min_price || ipo.issue_price) * ipo.lot_size);
  const maxPrice = ipo.max_price || ipo.issue_price;
  const minPrice = ipo.min_price || ipo.issue_price;

  const timelineMilestones = [
    { label: 'IPO Announced', date: ipo.bidding_start_date ? 'Announced' : 'TBD', status: 'COMPLETED' },
    { label: 'Bidding Opens', date: ipo.bidding_start_date || 'To be announced', status: ipo.status === 'OPEN' ? 'ACTIVE' : ipo.status === 'LISTED' || ipo.status === 'CLOSED' ? 'COMPLETED' : 'UPCOMING' },
    { label: 'Bidding Closes', date: ipo.bidding_end_date || 'To be announced', status: ipo.status === 'CLOSED' || ipo.status === 'LISTED' ? 'COMPLETED' : ipo.status === 'OPEN' ? 'ACTIVE' : 'UPCOMING' },
    { label: 'Basis of Allotment', date: ipo.allotment_date || 'To be announced', status: ipo.status === 'LISTED' ? 'COMPLETED' : 'UPCOMING' },
    { label: 'Refunds / Unblocking', date: ipo.allotment_date ? '1-2 Days Post Allotment' : 'TBD', status: ipo.status === 'LISTED' ? 'COMPLETED' : 'UPCOMING' },
    { label: 'Demat Credit', date: ipo.allotment_date ? 'Prior to Listing' : 'TBD', status: ipo.status === 'LISTED' ? 'COMPLETED' : 'UPCOMING' },
    { label: 'Listing on Exchange', date: ipo.listing_date || 'To be announced', status: ipo.status === 'LISTED' ? 'COMPLETED' : 'UPCOMING' }
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between bg-gradient-to-r from-slate-50 via-white to-blue-50/30">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-md shadow-blue-500/20">
              {ipo.symbol.substring(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900">{ipo.company_name}</h2>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {ipo.symbol}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                  ipo.is_sme ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}>
                  {ipo.is_sme ? 'SME Issue' : 'Mainboard'}
                </span>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                  ipo.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 animate-pulse' :
                  ipo.status === 'UPCOMING' ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' :
                  ipo.status === 'LISTED' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {ipo.status === 'OPEN' ? 'Open for Bidding' : ipo.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                <span>{ipo.sector || 'General Industry'}</span>
                <span>•</span>
                <span>{ipo.exchange}</span>
                {ipo.isin && (
                  <>
                    <span>•</span>
                    <span className="font-mono">ISIN: {ipo.isin}</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/70 px-6 gap-1 overflow-x-auto text-sm font-medium text-slate-600 no-scrollbar">
          {[
            { id: 'OVERVIEW', label: 'Overview & Issue Details', icon: Building2 },
            { id: 'TIMELINE', label: 'Timeline & Dates', icon: Calendar },
            { id: 'FINANCIALS', label: 'Financials & Performance', icon: BarChart3 },
            { id: 'VALUATION', label: 'Valuation & Peers', icon: TrendingUp },
            { id: 'SUBSCRIPTION', label: 'Subscription Data', icon: Layers },
            { id: 'RISKS', label: 'Strengths & Risks', icon: ShieldAlert },
            { id: 'DOCUMENTS', label: 'Prospectus & Links', icon: FileText },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSection(tab.id as TabSection)}
                className={`py-3 px-3.5 border-b-2 font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600 font-semibold bg-white'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700">
          {/* SECTION 1: OVERVIEW */}
          {activeSection === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Company Description */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Company Overview</h3>
                <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                  {ipo.description || `${ipo.company_name} is an active enterprise operating in the ${ipo.sector || 'Indian market'}, specializing in high-grade industrial and commercial solutions.`}
                </p>
              </div>

              {/* Key Highlights Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-500 font-medium">Price Band</span>
                  <div className="text-base font-bold text-slate-900 mt-1">
                    {minPrice === maxPrice ? `₹${maxPrice.toFixed(2)}` : `₹${minPrice.toFixed(2)} - ₹${maxPrice.toFixed(2)}`}
                  </div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-500 font-medium">Lot Size</span>
                  <div className="text-base font-bold text-slate-900 mt-1">{ipo.lot_size} Shares</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-500 font-medium">Minimum Investment</span>
                  <div className="text-base font-bold text-slate-900 mt-1">₹{minInv.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-500 font-medium">Total Issue Size</span>
                  <div className="text-base font-bold text-slate-900 mt-1">{ipo.issue_size || 'To be announced'}</div>
                </div>
              </div>

              {/* Detailed Specification Table */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">Issue Structure & Reservation</h3>
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-sm">
                  <div className="grid grid-cols-2 px-4 py-2.5 bg-slate-50">
                    <span className="text-slate-500">Issue Type</span>
                    <span className="font-medium text-slate-900">{ipo.issue_type || 'Book Built Issue'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5">
                    <span className="text-slate-500">Fresh Issue</span>
                    <span className="font-medium text-slate-900">{ipo.fresh_issue_size || 'Refer Prospectus'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5 bg-slate-50">
                    <span className="text-slate-500">Offer for Sale (OFS)</span>
                    <span className="font-medium text-slate-900">{ipo.offer_for_sale_size || 'Refer Prospectus'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5">
                    <span className="text-slate-500">Face Value</span>
                    <span className="font-medium text-slate-900">₹{ipo.face_value || 10.0} per share</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5 bg-slate-50">
                    <span className="text-slate-500">Retail Quota</span>
                    <span className="font-medium text-slate-900">{ipo.retail_quota || '35% of Issue'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5">
                    <span className="text-slate-500">QIB Quota</span>
                    <span className="font-medium text-slate-900">{ipo.qib_quota || '50% of Issue'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5 bg-slate-50">
                    <span className="text-slate-500">NII (HNI) Quota</span>
                    <span className="font-medium text-slate-900">{ipo.nii_quota || '15% of Issue'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5">
                    <span className="text-slate-500">Lead Managers</span>
                    <span className="font-medium text-slate-900">{ipo.lead_managers || 'ICICI Securities, Axis Capital'}</span>
                  </div>
                  <div className="grid grid-cols-2 px-4 py-2.5 bg-slate-50">
                    <span className="text-slate-500">Registrar</span>
                    <span className="font-medium text-slate-900">{ipo.registrar_name || 'Link Intime / KFintech'}</span>
                  </div>
                </div>
              </div>

              {/* Objects of the Issue */}
              {ipo.objects_of_issue_json && ipo.objects_of_issue_json.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-blue-600" /> Objects of the Issue
                  </h3>
                  <ul className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm">
                    {ipo.objects_of_issue_json.map((obj, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <ChevronRight className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* SECTION 2: TIMELINE */}
          {activeSection === 'TIMELINE' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Official IPO Lifecycle Timeline</h3>
                <p className="text-xs text-slate-500 mb-4">Dates are strictly aligned with Indian Standard Time (IST) exchange schedules.</p>
              </div>

              <div className="relative border-l-2 border-slate-200 ml-4 space-y-6 py-2">
                {timelineMilestones.map((m, idx) => (
                  <div key={idx} className="relative pl-6">
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-white ${
                      m.status === 'COMPLETED' ? 'border-emerald-600 bg-emerald-600 text-white' :
                      m.status === 'ACTIVE' ? 'border-blue-600 bg-blue-600 ring-4 ring-blue-100' :
                      'border-slate-300'
                    }`} />
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <span className="text-sm font-bold text-slate-900">{m.label}</span>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">{m.date}</div>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${
                        m.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        m.status === 'ACTIVE' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {m.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 3: FINANCIALS */}
          {activeSection === 'FINANCIALS' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Audited Financial Statements</h3>
                <p className="text-xs text-slate-500 mb-4">Figures reported in ₹ Crores (as disclosed in SEBI Red Herring Prospectus).</p>
              </div>

              {ipo.financials_json && ipo.financials_json.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                      <tr>
                        <th className="px-4 py-3">Metric (₹ Cr)</th>
                        {ipo.financials_json.map((f, i) => (
                          <th key={i} className="px-4 py-3 text-right">{f.period}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-slate-900">Total Revenue</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono font-semibold">₹{f.revenue?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">EBITDA</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono">₹{f.ebitda?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-slate-900">Profit After Tax (PAT)</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className={`px-4 py-2.5 text-right font-mono font-bold ${
                            (f.pat || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                            ₹{f.pat?.toFixed(2) || '-'}
                          </td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">Net Worth</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono">₹{f.net_worth?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-slate-900">Total Assets</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono">₹{f.total_assets?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">Total Borrowings</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono">₹{f.borrowings?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-medium text-slate-900">Basic EPS (₹)</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono font-semibold">₹{f.eps?.toFixed(2) || '-'}</td>
                        ))}
                      </tr>
                      <tr className="bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">Return on Net Worth (RoNW %)</td>
                        {ipo.financials_json.map((f, i) => (
                          <td key={i} className="px-4 py-2.5 text-right font-mono">{f.ronw ? `${f.ronw}%` : '-'}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-slate-50 p-8 text-center rounded-xl border border-dashed border-slate-200">
                  <p className="text-sm text-slate-500">Audited financials will be published upon release of final Red Herring Prospectus (RHP).</p>
                </div>
              )}
            </div>
          )}

          {/* SECTION 4: VALUATION */}
          {activeSection === 'VALUATION' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Valuation Ratios & Industry Multiples</h3>
                <p className="text-xs text-slate-500 mb-4">Calculated based on upper price band and annualized earnings per share.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">Issue P/E Ratio</span>
                  <div className="text-xl font-bold text-slate-900 mt-1">{ipo.valuation_json?.p_e_ratio || 'N/A'}</div>
                  <span className="text-[11px] text-slate-400">At cut-off price</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">Price to Book (P/B)</span>
                  <div className="text-xl font-bold text-slate-900 mt-1">{ipo.valuation_json?.p_b_ratio || 'N/A'}</div>
                  <span className="text-[11px] text-slate-400">Based on Net Worth</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">Industry Average P/E</span>
                  <div className="text-xl font-bold text-slate-900 mt-1">{ipo.valuation_json?.industry_pe || '28.5x'}</div>
                  <span className="text-[11px] text-slate-400">Listed Sector Peers</span>
                </div>
              </div>

              {ipo.valuation_json?.peers && ipo.valuation_json.peers.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Listed Peer Comparisons</h4>
                  <div className="flex flex-wrap gap-2">
                    {ipo.valuation_json.peers.map((peer, i) => (
                      <span key={i} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 font-medium">
                        {peer}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 5: SUBSCRIPTION */}
          {activeSection === 'SUBSCRIPTION' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">Live Subscription Status</h3>
                <p className="text-xs text-slate-500">
                  Last Updated: {ipo.subscription_details_json?.last_updated || 'Exchange Daily Close (17:00 IST)'}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">QIB Tranche</span>
                  <div className="text-xl font-bold text-blue-600 mt-1">{ipo.subscription_details_json?.qib || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">NII (HNI) Tranche</span>
                  <div className="text-xl font-bold text-indigo-600 mt-1">{ipo.subscription_details_json?.nii || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">Retail Individual</span>
                  <div className="text-xl font-bold text-emerald-600 mt-1">{ipo.subscription_details_json?.retail || 'N/A'}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">Total Subscription</span>
                  <div className="text-xl font-bold text-slate-900 mt-1">{ipo.subscription_rate || ipo.subscription_details_json?.total || 'N/A'}</div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: RISKS */}
          {activeSection === 'RISKS' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Key Strengths & Investment Risks</h3>
                <p className="text-xs text-slate-500 mb-4">Extracted from Section IV (Risk Factors) of official SEBI Prospectus.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                  <h4 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Business Strengths
                  </h4>
                  <ul className="space-y-2 text-xs text-emerald-950">
                    {ipo.strengths_risks_json?.strengths?.map((s, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-500 font-bold">•</span>
                        <span>{s}</span>
                      </li>
                    )) || (
                      <li>Established market position and multi-year track record.</li>
                    )}
                  </ul>
                </div>

                <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-100">
                  <h4 className="text-sm font-bold text-rose-900 mb-3 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600" /> Key Risk Factors
                  </h4>
                  <ul className="space-y-2 text-xs text-rose-950">
                    {ipo.strengths_risks_json?.risks?.map((r, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-rose-500 font-bold">•</span>
                        <span>{r}</span>
                      </li>
                    )) || (
                      <li>Industry-wide regulatory and macroeconomic credit cycle dependencies.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: DOCUMENTS */}
          {activeSection === 'DOCUMENTS' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Official Exchange & Regulatory Filings</h3>
                <p className="text-xs text-slate-500 mb-4">Direct links to official statutory filings submitted to SEBI and stock exchanges.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={ipo.drhp_url || 'https://www.sebi.gov.in/filings/public-issues.html'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-xl transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-blue-600" />
                    <div>
                      <span className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">Draft Red Herring Prospectus (DRHP)</span>
                      <div className="text-[11px] text-slate-500">SEBI Regulatory Filing</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
                </a>

                <a
                  href={ipo.rhp_url || 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-xl transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <div>
                      <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">Red Herring Prospectus (RHP)</span>
                      <div className="text-[11px] text-slate-500">Final Offer Document</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                </a>

                <a
                  href={ipo.registrar_url || 'https://linkintime.co.in/initial_offer/public-issues.html'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-emerald-50/50 border border-slate-200 rounded-xl transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-emerald-600" />
                    <div>
                      <span className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">Registrar Allotment Portal</span>
                      <div className="text-[11px] text-slate-500">{ipo.registrar_name || 'Official Registrar'}</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
                </a>

                <a
                  href="https://trade.angelone.in/ipo"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-xl transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <ExternalLink className="w-4 h-4 text-blue-600" />
                    <div>
                      <span className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">Angel One Official IPO Portal</span>
                      <div className="text-[11px] text-slate-500">Official Submission Link</div>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Min. Investment: <span className="font-bold text-slate-900 font-mono">₹{minInv.toLocaleString('en-IN')}</span> ({ipo.lot_size} shares)
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-medium text-sm hover:bg-white transition-colors"
            >
              Close
            </button>
            {ipo.status === 'OPEN' && (
              <button
                onClick={() => {
                  onClose();
                  onApply(ipo);
                }}
                className="px-5 py-2 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all flex items-center gap-1.5"
              >
                Apply / Prepare Workspace
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
