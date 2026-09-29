// Field names verified against dev.joinposter.com docs and real responses (2026-09-29).
// Poster returns numbers as strings. Money is in kopecks unless noted.

export interface PosterClientRecord {
  client_id: string;
  firstname: string;
  lastname: string;
  patronymic: string;
  discount_per: string;
  /** Kopecks. */
  bonus: string;
  /** Kopecks. */
  total_payed_sum: string;
  phone: string;
  /** Digits only, e.g. 380991234567. */
  phone_number: string;
  birthday: string;
  client_groups_id: string;
  client_groups_name: string;
  client_groups_discount: string;
  /** "1" bonus program, "2" discount program. */
  loyalty_type: string;
  delete?: string;
}

export interface PosterTransaction {
  transaction_id: string;
  /** Milliseconds since epoch, as a string. */
  date_close: string;
  status: string;
  client_id: string;
  sum: string;
  payed_sum: string;
  payed_bonus: string;
  payed_cert?: string;
  payed_ewallet?: string;
  payed_third_party?: string;
}

export interface CreateClientInput {
  client_name: string;
  client_groups_id_client: number;
  phone: string;
  birthday?: string;
}

/** The subset of the Poster API the functions use — lets tests swap in a fake. */
export interface PosterApi {
  findClientsByPhone(phone: string): Promise<PosterClientRecord[]>;
  getClient(clientId: number): Promise<PosterClientRecord | null>;
  createClient(input: CreateClientInput): Promise<number>;
  /** `amountUah` in hryvnias (verified: +1 adds 100 kopecks). Returns the new balance in hryvnias. */
  changeClientBonus(clientId: number, amountUah: number): Promise<number>;
  getClientTransactions(clientId: number, dateFrom: string, dateTo: string): Promise<PosterTransaction[]>;
}
