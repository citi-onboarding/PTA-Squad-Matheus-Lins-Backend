import type {
  ErpCustomer,
  ErpProduct,
  ErpReceivable,
} from "../../shared/erp/erp-schemas.js";

export interface CustomerRecord {
  code: string;
  legalName: string;
  cnpj: string;
  city: string;
  state: string;
  segment: string;
  creditLimitCents: number;
  sellerCode: string;
  registeredAt: Date;
  status: "ACTIVE" | "BLOCKED" | "INACTIVE";
  erpUpdatedAt: Date;
}

export interface ProductRecord {
  code: string;
  description: string;
  category: string;
  unit: string;
  listPriceCents: number;
  active: boolean;
  erpUpdatedAt: Date;
}

export interface ReceivableRecord {
  number: number;
  customerCode: string;
  erpOrderNumber: number;
  installment: string;
  amountCents: number;
  issuedAt: Date;
  dueAt: Date;
  paidAt: Date | null;
  status: "PAID" | "OPEN" | "OVERDUE";
  source: "ERP";
  erpUpdatedAt: Date;
}

const customerStatus: Record<ErpCustomer["status"], CustomerRecord["status"]> =
  {
    ATIVO: "ACTIVE",
    BLOQUEADO: "BLOCKED",
    INATIVO: "INACTIVE",
  };

const receivableStatus: Record<
  ErpReceivable["status"],
  ReceivableRecord["status"]
> = {
  PAGO: "PAID",
  EM_ABERTO: "OPEN",
  VENCIDO: "OVERDUE",
};

/** A date-only ERP value is midnight in Recife, which has no daylight saving time. */
function recifeMidnight(date: string): Date {
  return new Date(`${date}T00:00:00-03:00`);
}

export function toCustomer(customer: ErpCustomer): CustomerRecord {
  return {
    code: customer.codigo,
    legalName: customer.razaoSocial,
    cnpj: customer.cnpj,
    city: customer.cidade,
    state: customer.uf,
    segment: customer.segmento,
    creditLimitCents: customer.limiteCreditoCentavos,
    sellerCode: customer.vendedor,
    registeredAt: recifeMidnight(customer.dataCadastro),
    status: customerStatus[customer.status],
    erpUpdatedAt: new Date(customer.atualizadoEm),
  };
}

export function toProduct(product: ErpProduct): ProductRecord {
  return {
    code: product.codigo,
    description: product.descricao,
    category: product.categoria,
    unit: product.unidade,
    listPriceCents: product.precoTabelaCentavos,
    active: product.ativo,
    erpUpdatedAt: new Date(product.atualizadoEm),
  };
}

export function toReceivable(receivable: ErpReceivable): ReceivableRecord {
  return {
    number: receivable.numero,
    customerCode: receivable.cliente,
    erpOrderNumber: receivable.pedidoErp,
    installment: receivable.parcela,
    amountCents: receivable.valorCentavos,
    issuedAt: recifeMidnight(receivable.emissao),
    dueAt: recifeMidnight(receivable.vencimento),
    paidAt:
      receivable.pagamento === null
        ? null
        : recifeMidnight(receivable.pagamento),
    status: receivableStatus[receivable.status],
    source: "ERP",
    erpUpdatedAt: new Date(receivable.atualizadoEm),
  };
}
