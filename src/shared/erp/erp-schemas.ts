import { z } from "zod";

// Field names follow the ERP contract (Portuguese) on purpose: these schemas
// describe an external API, not the portal's domain model.
// Source: https://pta-erp-api.onrender.com/openapi.json (version 3.3.0).

const erpDate = z.iso.date();
const erpDateTime = z.iso.datetime({ offset: true });

export const erpCustomerSchema = z.object({
  codigo: z.string(),
  razaoSocial: z.string(),
  cnpj: z.string(),
  cidade: z.string(),
  uf: z.string(),
  segmento: z.string(),
  limiteCreditoCentavos: z.int(),
  vendedor: z.string(),
  dataCadastro: erpDate,
  status: z.enum(["ATIVO", "BLOQUEADO", "INATIVO"]),
  atualizadoEm: erpDateTime,
});

export const erpProductSchema = z.object({
  codigo: z.string(),
  descricao: z.string(),
  categoria: z.string(),
  unidade: z.string(),
  precoTabelaCentavos: z.int(),
  ativo: z.boolean(),
  atualizadoEm: erpDateTime,
});

export const erpReceivableSchema = z.object({
  numero: z.int(),
  cliente: z.string(),
  pedidoErp: z.int(),
  parcela: z.string(),
  valorCentavos: z.int(),
  emissao: erpDate,
  vencimento: erpDate,
  pagamento: erpDate.nullable(),
  status: z.enum(["PAGO", "EM_ABERTO", "VENCIDO"]),
  atualizadoEm: erpDateTime,
});

/** Page envelope; records stay `unknown` so each one is validated on its own. */
export const erpPageSchema = z.object({
  dados: z.array(z.unknown()),
  pagina: z.int(),
  tamanho: z.int(),
  total: z.int(),
  totalPaginas: z.int(),
});

/** RFC 9457 Problem Details as returned by the ERP. */
export const erpProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  detail: z.string(),
  instance: z.string(),
  erros: z
    .array(z.object({ campo: z.string(), mensagem: z.string() }))
    .optional(),
});

export type ErpCustomer = z.infer<typeof erpCustomerSchema>;
export type ErpProduct = z.infer<typeof erpProductSchema>;
export type ErpReceivable = z.infer<typeof erpReceivableSchema>;
export type ErpPage = z.infer<typeof erpPageSchema>;
