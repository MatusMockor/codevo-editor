export interface SettingsSectionHeaderProps {
  readonly label: string;
}

export function SettingsSectionHeader({ label }: SettingsSectionHeaderProps) {
  return (
    <header className="settings-section__header">
      <h2>{label}</h2>
    </header>
  );
}
