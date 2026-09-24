import { projectInitial } from "./projectInitial";
import "./shell.css";

export function ProjectFavicon({ label }: { readonly label: string }) {
  return (
    <span aria-hidden="true" className="cv-favicon">
      {projectInitial(label)}
    </span>
  );
}
