/**
 * Unified QuickBooks Data Edge Function
 *
 * Fetches live AP, AR, bank balance, vendor, customer, and P&L data
 * from QuickBooks using the shared OAuth token stored in WCW's Supabase.
 *
 * POST body: { type: "ap" | "ar" | "bank" | "pnl" | "vendors" | "customers" | "payments" | "bill_payments" | "summary" }
 *
 * Returns structured JSON tailored for Sherpa AI analysis.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getQBOToken, queryQBO, fetchQBOReport } from '../_shared/qbo-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, options } = await req.json();

    // Get QB token from WCW
    const { token, connection } = await getQBOToken();

    let result: any;

    switch (type) {
      case 'ap':
        result = await fetchAPData(token, connection);
        break;
      case 'ar':
        result = await fetchARData(token, connection);
        break;
      case 'bank':
        result = await fetchBankBalances(token, connection);
        break;
      case 'pnl':
        result = await fetchProfitAndLoss(token, connection, options);
        break;
      case 'vendors':
        result = await fetchVendors(token, connection);
        break;
      case 'customers':
        result = await fetchCustomers(token, connection);
        break;
      case 'payments':
        result = await fetchCustomerPayments(token, connection, options);
        break;
      case 'bill_payments':
        result = await fetchBillPayments(token, connection, options);
        break;
      case 'summary':
        result = await fetchFinancialSummary(token, connection);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown data type: ${type}. Use: ap, ar, bank, pnl, vendors, customers, payments, bill_payments, summary` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    return new Response(
      JSON.stringify({ success: true, type, company: connection.company_name, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-data error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ─── AP (Accounts Payable) ─────────────────────────────────────────────────

async function fetchAPData(token: string, connection: any) {
  // Fetch unpaid bills
  const billData = await queryQBO(token, connection,
    "SELECT * FROM Bill WHERE Balance > '0' MAXRESULTS 1000");
  const bills = billData.QueryResponse?.Bill || [];

  // Fetch terms for mapping
  const termData = await queryQBO(token, connection,
    "SELECT * FROM Term MAXRESULTS 100");
  const terms = termData.QueryResponse?.Term || [];
  const termMap = new Map(terms.map((t: any) => [t.Id, { name: t.Name, days: t.DueDays || 0 }]));

  // Fetch vendor credits
  let credits: any[] = [];
  try {
    const creditData = await queryQBO(token, connection,
      "SELECT * FROM VendorCredit WHERE Balance > '0' MAXRESULTS 500");
    credits = creditData.QueryResponse?.VendorCredit || [];
  } catch (e) {
    console.warn('Could not fetch vendor credits:', e);
  }

  const today = new Date();

  const transformedBills = bills.map((bill: any) => {
    const dueDate = bill.DueDate ? new Date(bill.DueDate) : null;
    const daysOverdue = dueDate
      ? Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      id: bill.Id,
      vendor: bill.VendorRef?.name || 'Unknown',
      vendorId: bill.VendorRef?.value,
      billNumber: bill.DocNumber || null,
      billDate: bill.TxnDate,
      dueDate: bill.DueDate || null,
      amount: bill.TotalAmt,
      balance: bill.Balance,
      daysOverdue,
      agingBucket: getAgingBucket(daysOverdue),
      terms: bill.SalesTermRef?.name || null,
      description: (bill.Line || []).filter((l: any) => l.Description).map((l: any) => l.Description).join('; ') || null,
      memo: bill.PrivateNote || null,
    };
  });

  const transformedCredits = credits.map((credit: any) => ({
    id: `VC-${credit.Id}`,
    vendor: credit.VendorRef?.name || 'Unknown',
    vendorId: credit.VendorRef?.value,
    amount: -credit.TotalAmt,
    balance: -credit.Balance,
    date: credit.TxnDate,
    type: 'VendorCredit',
  }));

  // Aging summary
  const agingSummary = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '91+': 0 };
  for (const bill of transformedBills) {
    agingSummary[bill.agingBucket as keyof typeof agingSummary] += bill.balance;
  }

  return {
    bills: transformedBills,
    credits: transformedCredits,
    totalAP: transformedBills.reduce((s: number, b: any) => s + b.balance, 0),
    totalCredits: transformedCredits.reduce((s: number, c: any) => s + c.balance, 0),
    agingSummary,
    billCount: transformedBills.length,
  };
}

// ─── AR (Accounts Receivable) ──────────────────────────────────────────────

async function fetchARData(token: string, connection: any) {
  // Fetch invoices from last 18 months (both paid and unpaid for analysis)
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  const dateFilter = eighteenMonthsAgo.toISOString().split('T')[0];

  const invoiceData = await queryQBO(token, connection,
    `SELECT * FROM Invoice WHERE TxnDate >= '${dateFilter}' AND Balance >= '0' MAXRESULTS 1000`);
  const invoices = invoiceData.QueryResponse?.Invoice || [];

  // Fetch credit memos
  let creditMemos: any[] = [];
  try {
    const creditData = await queryQBO(token, connection,
      "SELECT * FROM CreditMemo WHERE Balance > '0' MAXRESULTS 500");
    creditMemos = creditData.QueryResponse?.CreditMemo || [];
  } catch (e) {
    console.warn('Could not fetch credit memos:', e);
  }

  const today = new Date();

  const transformedInvoices = invoices.map((inv: any) => {
    const dueDate = inv.DueDate ? new Date(inv.DueDate) : null;
    const daysPastDue = dueDate
      ? Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    let status = 'Open';
    if (inv.Balance === 0) status = 'Paid';
    else if (inv.Balance < inv.TotalAmt) status = 'PartiallyPaid';

    return {
      id: inv.Id,
      customer: inv.CustomerRef?.name || 'Unknown',
      customerId: inv.CustomerRef?.value,
      invoiceNumber: inv.DocNumber || null,
      invoiceDate: inv.TxnDate,
      dueDate: inv.DueDate || null,
      amount: inv.TotalAmt,
      balance: inv.Balance,
      daysPastDue,
      agingBucket: getAgingBucket(daysPastDue),
      status,
      terms: inv.SalesTermRef?.name || null,
    };
  });

  // Split into open vs paid for analysis
  const openInvoices = transformedInvoices.filter((i: any) => i.status !== 'Paid');
  const paidInvoices = transformedInvoices.filter((i: any) => i.status === 'Paid');

  // Aging summary (open only)
  const agingSummary = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '91+': 0 };
  for (const inv of openInvoices) {
    agingSummary[inv.agingBucket as keyof typeof agingSummary] += inv.balance;
  }

  return {
    openInvoices,
    paidInvoices: paidInvoices.slice(0, 50), // Limit paid history for context size
    creditMemos: creditMemos.map((cm: any) => ({
      id: cm.Id,
      customer: cm.CustomerRef?.name || 'Unknown',
      amount: cm.TotalAmt,
      balance: cm.Balance,
      date: cm.TxnDate,
    })),
    totalOpenAR: openInvoices.reduce((s: number, i: any) => s + i.balance, 0),
    agingSummary,
    openInvoiceCount: openInvoices.length,
    paidInvoiceCount: paidInvoices.length,
  };
}

// ─── Bank Balances ─────────────────────────────────────────────────────────

async function fetchBankBalances(token: string, connection: any) {
  const accountData = await queryQBO(token, connection,
    "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') AND Active = true");
  const accounts = accountData.QueryResponse?.Account || [];

  const bankAccounts = accounts
    .filter((a: any) => a.AccountType === 'Bank')
    .map((a: any) => ({
      id: a.Id,
      name: a.FullyQualifiedName || a.Name,
      type: a.AccountSubType || 'Checking',
      balance: a.CurrentBalance || 0,
      currency: a.CurrencyRef?.value || 'USD',
    }));

  const creditCards = accounts
    .filter((a: any) => a.AccountType === 'Credit Card')
    .map((a: any) => ({
      id: a.Id,
      name: a.FullyQualifiedName || a.Name,
      balance: a.CurrentBalance || 0,
      currency: a.CurrencyRef?.value || 'USD',
    }));

  return {
    bankAccounts,
    creditCards,
    totalCash: bankAccounts.reduce((s: number, a: any) => s + a.balance, 0),
    totalCreditCardBalance: creditCards.reduce((s: number, a: any) => s + a.balance, 0),
  };
}

// ─── Profit & Loss ─────────────────────────────────────────────────────────

async function fetchProfitAndLoss(token: string, connection: any, options?: any) {
  const params: Record<string, string> = {};
  if (options?.startDate) params.start_date = options.startDate;
  if (options?.endDate) params.end_date = options.endDate;
  if (options?.summarizeBy) params.summarize_columns_by = options.summarizeBy;

  const report = await fetchQBOReport(token, connection, 'ProfitAndLoss', params);

  // Extract header and column labels
  const columns = report.Columns?.Column?.map((c: any) => c.ColTitle) || [];

  // Parse report rows into flat structure
  const sections: any[] = [];
  if (report.Rows?.Row) {
    for (const row of report.Rows.Row) {
      sections.push(parseReportSection(row));
    }
  }

  return {
    reportName: report.Header?.ReportName,
    startDate: report.Header?.StartPeriod,
    endDate: report.Header?.EndPeriod,
    currency: report.Header?.Currency,
    columns,
    sections,
  };
}

function parseReportSection(row: any, depth = 0): any {
  const section: any = { depth };

  if (row.Header?.ColData) {
    section.label = row.Header.ColData[0]?.value;
  }

  if (row.ColData) {
    section.label = row.ColData[0]?.value;
    section.values = row.ColData.slice(1).map((c: any) => c.value);
  }

  if (row.Summary?.ColData) {
    section.summary = row.Summary.ColData[0]?.value;
    section.summaryValues = row.Summary.ColData.slice(1).map((c: any) => c.value);
  }

  if (row.Rows?.Row) {
    section.children = row.Rows.Row.map((r: any) => parseReportSection(r, depth + 1));
  }

  if (row.type) section.type = row.type;

  return section;
}

// ─── Vendors ───────────────────────────────────────────────────────────────

async function fetchVendors(token: string, connection: any) {
  const vendorData = await queryQBO(token, connection,
    "SELECT * FROM Vendor WHERE Active = true MAXRESULTS 1000");
  const vendors = vendorData.QueryResponse?.Vendor || [];

  return vendors.map((v: any) => ({
    id: v.Id,
    name: v.DisplayName,
    balance: v.Balance || 0,
    email: v.PrimaryEmailAddr?.Address || null,
    phone: v.PrimaryPhone?.FreeFormNumber || null,
    terms: v.TermRef?.name || null,
  }));
}

// ─── Customers ─────────────────────────────────────────────────────────────

async function fetchCustomers(token: string, connection: any) {
  const customerData = await queryQBO(token, connection,
    "SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000");
  const customers = customerData.QueryResponse?.Customer || [];

  return customers.map((c: any) => ({
    id: c.Id,
    name: c.DisplayName,
    balance: c.Balance || 0,
    email: c.PrimaryEmailAddr?.Address || null,
    phone: c.PrimaryPhone?.FreeFormNumber || null,
    terms: c.SalesTermRef?.name || null,
  }));
}

// ─── Financial Summary (all-in-one snapshot) ───────────────────────────────

async function fetchFinancialSummary(token: string, connection: any) {
  const [ap, ar, bank] = await Promise.all([
    fetchAPData(token, connection),
    fetchARData(token, connection),
    fetchBankBalances(token, connection),
  ]);

  return {
    asOf: new Date().toISOString(),
    cashPosition: {
      totalCash: bank.totalCash,
      totalCreditCardDebt: bank.totalCreditCardBalance,
      netCash: bank.totalCash + bank.totalCreditCardBalance,
      accounts: bank.bankAccounts,
    },
    accountsReceivable: {
      totalOpen: ar.totalOpenAR,
      openInvoiceCount: ar.openInvoiceCount,
      aging: ar.agingSummary,
    },
    accountsPayable: {
      totalOpen: ap.totalAP,
      totalCredits: ap.totalCredits,
      netAP: ap.totalAP + ap.totalCredits,
      openBillCount: ap.billCount,
      aging: ap.agingSummary,
    },
    workingCapital: {
      netWorkingCapital: bank.totalCash + ar.totalOpenAR - ap.totalAP,
      currentRatio: ap.totalAP > 0 ? (bank.totalCash + ar.totalOpenAR) / ap.totalAP : null,
    },
  };
}

// ─── Customer Payments (cash collected) ───────────────────────────────────

async function fetchCustomerPayments(token: string, connection: any, options?: any) {
  const startDate = options?.startDate
    || (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; })();
  const endDate = options?.endDate || new Date().toISOString().split('T')[0];

  const allPayments: any[] = [];
  let startPosition = 1;
  const pageSize = 500;

  while (true) {
    const data = await queryQBO(token, connection,
      `SELECT * FROM Payment WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' ORDER BY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`);
    const page = data.QueryResponse?.Payment || [];
    allPayments.push(...page);
    if (page.length < pageSize) break;
    startPosition += pageSize;
  }

  const transformed = allPayments.map((p: any) => {
    // Which invoices were applied
    const appliedTo = (p.Line || [])
      .filter((line: any) => line.LinkedTxn?.length > 0)
      .map((line: any) => ({
        amount: line.Amount,
        invoiceIds: line.LinkedTxn?.filter((t: any) => t.TxnType === 'Invoice').map((t: any) => t.TxnId) || [],
      }));

    return {
      id: p.Id,
      date: p.TxnDate,
      customer: p.CustomerRef?.name || 'Unknown',
      customerId: p.CustomerRef?.value,
      amount: p.TotalAmt,
      unapplied: p.UnappliedAmt || 0,
      paymentMethod: p.PaymentMethodRef?.name || null,
      depositToAccount: p.DepositToAccountRef?.name || null,
      docNumber: p.DocNumber || null,
      memo: p.PrivateNote || null,
      appliedTo,
    };
  });

  const byCustomer: Record<string, number> = {};
  for (const p of transformed) {
    byCustomer[p.customer] = (byCustomer[p.customer] || 0) + p.amount;
  }

  const byMethod: Record<string, number> = {};
  for (const p of transformed) {
    const method = p.paymentMethod || 'Unspecified';
    byMethod[method] = (byMethod[method] || 0) + p.amount;
  }

  return {
    payments: transformed,
    totalCashCollected: transformed.reduce((s: number, p: any) => s + p.amount, 0),
    paymentCount: transformed.length,
    dateRange: { from: startDate, to: endDate },
    byCustomer,
    byMethod,
  };
}

// ─── Bill Payments ─────────────────────────────────────────────────────────

async function fetchBillPayments(token: string, connection: any, options?: any) {
  // Default to last 6 months if no date range specified
  const startDate = options?.startDate
    || (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; })();
  const endDate = options?.endDate || new Date().toISOString().split('T')[0];

  // Paginate — BillPayment can be large
  const allPayments: any[] = [];
  let startPosition = 1;
  const pageSize = 500;

  while (true) {
    const data = await queryQBO(token, connection,
      `SELECT * FROM BillPayment WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' ORDER BY TxnDate DESC STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`);
    const page = data.QueryResponse?.BillPayment || [];
    allPayments.push(...page);
    if (page.length < pageSize) break;
    startPosition += pageSize;
  }

  const transformed = allPayments.map((bp: any) => {
    // Determine payment method and account
    let paymentMethod = bp.PayType || 'Unknown';
    let accountName: string | null = null;
    let checkNum: string | null = null;

    if (bp.PayType === 'Check' && bp.CheckPayment) {
      accountName = bp.CheckPayment.BankAccountRef?.name || null;
      checkNum = bp.CheckPayment.PrintStatus === 'NeedToPrint' ? null : (bp.DocNumber || null);
    } else if (bp.PayType === 'CreditCard' && bp.CreditCardPayment) {
      accountName = bp.CreditCardPayment.CCAccountRef?.name || null;
      paymentMethod = 'Credit Card';
    }

    // Extract which bills were paid
    const billsPaid = (bp.Line || [])
      .filter((line: any) => line.LinkedTxn?.length > 0)
      .map((line: any) => ({
        amount: line.Amount,
        billIds: line.LinkedTxn?.filter((t: any) => t.TxnType === 'Bill').map((t: any) => t.TxnId) || [],
      }));

    return {
      id: bp.Id,
      date: bp.TxnDate,
      vendor: bp.VendorRef?.name || 'Unknown',
      vendorId: bp.VendorRef?.value,
      amount: bp.TotalAmt,
      paymentMethod,
      accountName,
      checkNum,
      docNumber: bp.DocNumber || null,
      memo: bp.PrivateNote || null,
      billsPaid,
    };
  });

  // Summary by vendor
  const byVendor: Record<string, number> = {};
  for (const p of transformed) {
    byVendor[p.vendor] = (byVendor[p.vendor] || 0) + p.amount;
  }

  // Summary by payment method
  const byMethod: Record<string, number> = {};
  for (const p of transformed) {
    byMethod[p.paymentMethod] = (byMethod[p.paymentMethod] || 0) + p.amount;
  }

  return {
    payments: transformed,
    totalPaid: transformed.reduce((s: number, p: any) => s + p.amount, 0),
    paymentCount: transformed.length,
    dateRange: { from: startDate, to: endDate },
    byVendor,
    byMethod,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getAgingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '91+';
}
