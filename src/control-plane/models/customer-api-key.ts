export interface CustomerApiKey {
  id: string;
  keyId: string;
  name: string;
  customerId: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  allowedModelIds: string[];
  spendLimit: number | null;
  spent: number;
  requestRate: number | null;
}

export interface IssuedCustomerApiKey {
  apiKey: CustomerApiKey;
  key: string;
}

export interface CustomerApiKeyPage {
  keys: CustomerApiKey[];
  nextPageToken: string | null;
}
