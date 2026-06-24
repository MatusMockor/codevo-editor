export interface SystemFontGateway {
  listMonospaceFontFamilies(): Promise<string[]>;
}
