export interface Account {
  id: number;
  nickname: string;
  masked_client_code: string;
  account_group: string;
  is_enabled: boolean;
  is_demo: boolean;
  auth_status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'ERROR';
  ddpi_status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  edis_authorized_today: boolean;
  available_cash: number;
  last_sync_time?: string;
  last_auth_error?: string;
  created_at: string;
}

export interface AccountCreatePayload {
  nickname: string;
  client_code: string;
  account_group: string;
  api_key: string;
  pin: string;
  totp_secret: string;
  is_demo?: boolean;
}

export interface IPO {
  id: number;
  symbol: string;
  company_name: string;
  exchange: string;
  issue_price: number;
  min_price?: number;
  max_price?: number;
  lot_size: number;
  bidding_start_date?: string;
  bidding_end_date?: string;
  allotment_date?: string;
  listing_date?: string;
  isin?: string;
  symbol_token?: string;
  is_sme: boolean;
  current_ltp?: number;
  previous_close?: number;
  status: 'UPCOMING' | 'OPEN' | 'PRE_OPEN' | 'LISTED' | 'CLOSED';
  subscription_rate?: string;
  min_investment?: number;
  issue_size?: string;
  source_name?: string;
  source_timestamp?: string;
  last_sync_at?: string;
  total_allotted_shares: number;
  total_accounts_allotted: number;
  estimated_current_value: number;
  estimated_pnl: number;
  pnl_percentage: number;
  created_at: string;
}

export interface Allotment {
  id: number;
  ipo_id: number;
  account_id: number;
  account_nickname: string;
  account_masked_code: string;
  account_group: string;
  ipo_symbol: string;
  application_no?: string;
  category?: string;
  applied_quantity: number;
  allotted_quantity: number;
  acquisition_cost: number;
  current_ltp?: number;
  market_value: number;
  unrealized_pnl: number;
  pnl_percentage: number;
  pan_masked?: string;
  upi_id_masked?: string;
  mandate_status?: string;
  allotment_status?: string;
  demat_credit_status?: string;
  status: string;
  demat_verified: boolean;
  verification_source?: string;
  verification_timestamp?: string;
  conflict_note?: string;
  ddpi_status: string;
  edis_authorized: boolean;
  created_at: string;
}

export interface CSVImportSummary {
  imported_count: number;
  updated_count: number;
  conflict_count: number;
  skipped_count: number;
  conflicts: string[];
  errors: string[];
}

export interface IPOApplicationPreparedItem {
  account_id: number;
  account_nickname: string;
  account_masked_code: string;
  ipo_symbol: string;
  category: string;
  lots: number;
  shares: number;
  cut_off_price: number;
  total_amount: number;
  is_valid: boolean;
  validation_message?: string;
  duplicate_warning?: string;
}

export interface IPOPrepareApplicationResponse {
  ipo_id: number;
  ipo_symbol: string;
  company_name: string;
  lot_size: number;
  issue_price: number;
  total_accounts: number;
  total_shares: number;
  total_amount: number;
  applications: IPOApplicationPreparedItem[];
  all_valid: boolean;
}


export interface Order {
  id: number;
  client_order_id: string;
  account_id: number;
  account_nickname?: string;
  account_masked_code?: string;
  broker_order_id?: string;
  batch_id?: string;
  tradingsymbol: string;
  symbol_token: string;
  exchange: string;
  transaction_type: 'BUY' | 'SELL';
  order_type: 'LIMIT' | 'MARKET' | 'STOPLOSS_LIMIT' | 'STOPLOSS_MARKET';
  product_type: string;
  variety: string;
  quantity: number;
  filled_quantity: number;
  price: number;
  trigger_price: number;
  execution_price?: number;
  status: 'PREPARED' | 'SUBMITTED' | 'ACCEPTED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED';
  rejection_reason?: string;
  is_paper_trade: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketQuote {
  symbol: string;
  company_name: string;
  exchange: string;
  symbol_token?: string;
  ltp: number;
  previous_close: number;
  change: number;
  change_percent: number;
  data_source: string;
  is_stale: boolean;
  timestamp: string;
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketCandleResponse {
  symbol: string;
  company_name: string;
  exchange: string;
  symbol_token: string;
  current_ltp: number;
  previous_close: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  interval: string;
  range_period: string;
  data_source: string;
  is_stale: boolean;
  last_updated: string;
  candles: MarketCandle[];
}

export interface ConsolidatedHolding {
  key?: string;
  symbol: string;
  company_name: string;
  exchange: string;
  isin?: string;
  symbol_token?: string;
  total_quantity: number;
  total_cost: number;
  current_ltp: number;
  previous_close?: number;
  day_change?: number;
  day_change_percent?: number;
  market_value: number;
  unrealized_pnl: number;
  pnl_percentage: number;
  average_cost: number;
  portfolio_allocation_percent?: number;
  accounts_count: number;
  data_source?: string;
  last_updated?: string;
  accounts_breakdown: Array<{
    account_id: number;
    nickname: string;
    masked_client_code: string;
    account_group: string;
    quantity: number;
    acquisition_cost: number;
    market_value: number;
    unrealized_pnl: number;
    pnl_percentage?: number;
    ddpi_status: string;
    edis_authorized: boolean;
    sync_status?: string;
  }>;
}

export interface PortfolioSummary {
  total_current_value: number;
  total_investment_cost: number;
  unrealized_pnl: number;
  unrealized_pnl_percentage: number;
  day_change: number;
  day_change_percentage: number;
  total_accounts_connected: number;
  total_accounts_selected: number;
  total_accounts_synced: number;
  total_accounts_failed: number;
  distinct_instruments_count: number;
  total_shares_count: number;
  last_sync_time: string;
  calculation_basis: string;
}

export interface ConsolidatedPortfolioResponse {
  summary: PortfolioSummary;
  holdings: ConsolidatedHolding[];
}

export interface AccountPortfolio {
  account_id: number;
  nickname: string;
  masked_client_code: string;
  account_group: string;
  auth_status: string;
  ddpi_status: string;
  edis_authorized: boolean;
  available_cash: number;
  portfolio_value: number;
  last_sync_time?: string;
  unrealized_pnl: number;
  pnl_percentage: number;
  holdings: Array<{
    allotment_id: number;
    symbol: string;
    company_name: string;
    quantity: number;
    acquisition_cost: number;
    current_ltp: number;
    market_value: number;
    unrealized_pnl: number;
    pnl_percentage: number;
  }>;
}

export interface ProposedOrderItem {
  account_id: number;
  nickname: string;
  masked_client_code: string;
  account_group: string;
  holding_quantity: number;
  proposed_quantity: number;
  price: number;
  order_type: string;
  estimated_value: number;
  ddpi_active: boolean;
  edis_authorized: boolean;
  is_valid: boolean;
  message: string;
}

export interface BulkOrderPreview {
  batch_id: string;
  is_executable: boolean;
  total_accounts: number;
  total_quantity: number;
  total_estimated_value: number;
  proposed_orders: ProposedOrderItem[];
  blocking_errors: string[];
  warnings: string[];
}

export interface RiskLimit {
  id: number;
  account_id?: number;
  max_order_value: number;
  max_quantity_per_order: number;
  max_loss_threshold: number;
  stop_loss_percent: number;
  target_profit_percent: number;
  emergency_trading_disabled: boolean;
  allow_market_orders_on_listing: boolean;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  event_type: string;
  account_id?: number;
  operator: string;
  details: Record<string, any>;
}

export interface DashboardSummary {
  trading_mode: 'PAPER' | 'LIVE';
  total_accounts: number;
  connected_accounts: number;
  disconnected_accounts: number;
  error_accounts: number;
  total_ipos_monitored: number;
  total_allotted_shares: number;
  total_portfolio_value: number;
  total_unrealized_pnl: number;
  pnl_percentage: number;
  orders_today_count: number;
  orders_filled_count: number;
  orders_rejected_count: number;
  emergency_trading_disabled: boolean;
  server_time: string;
}

export interface AccountOverviewResponse {
  account_id: number;
  nickname: string;
  masked_client_code: string;
  account_group: string;
  is_enabled: boolean;
  is_demo: boolean;
  auth_status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'ERROR';
  ddpi_status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  edis_authorized_today: boolean;
  available_cash: number | null;
  total_margin: number | null;
  utilized_margin: number | null;
  total_holdings_count: number;
  total_holdings_value: number;
  total_positions_count: number;
  last_sync_time?: string | null;
  data_source: string;
  stale_data_warning: boolean;
}

export interface AccountHoldingItem {
  symbol: string;
  company_name?: string;
  isin?: string;
  symbol_token?: string;
  quantity: number;
  authorised_quantity?: number;
  average_price: number;
  current_ltp?: number;
  valuation?: number;
  unrealized_pnl?: number;
  pnl_percentage?: number;
  data_source: string;
  source_timestamp?: string;
}

export interface AccountPositionItem {
  symbol: string;
  symbol_token?: string;
  exchange: string;
  product_type: string;
  net_quantity: number;
  buy_quantity: number;
  sell_quantity: number;
  buy_average_price: number;
  sell_average_price: number;
  current_ltp?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
  data_source: string;
  source_timestamp?: string;
}

export interface AccountOrderItem {
  order_id: string;
  symbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  product_type: string;
  quantity: number;
  filled_quantity: number;
  price: number;
  trigger_price: number;
  average_price?: number;
  status: string;
  rejection_reason?: string;
  order_timestamp?: string;
  is_paper_trade: boolean;
}

export interface AccountTradeItem {
  fill_id: string;
  order_id: string;
  symbol: string;
  exchange: string;
  transaction_type: string;
  product_type: string;
  fill_price: number;
  fill_quantity: number;
  fill_timestamp?: string;
  is_paper_trade: boolean;
}

export interface AccountSyncResponse {
  account_id: number;
  success: boolean;
  message: string;
  holdings_count: number;
  positions_count: number;
  available_cash?: number | null;
  sync_timestamp: string;
}
