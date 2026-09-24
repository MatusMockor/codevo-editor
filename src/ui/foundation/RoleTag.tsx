import "./status.css";

export interface RoleTagProps {
  readonly children: string;
}

export function RoleTag({ children }: RoleTagProps) {
  return (
    <span className="cv-role" title={children}>
      {children}
    </span>
  );
}
