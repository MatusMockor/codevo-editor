import { Plus } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import "./projectBanners.css";

export function NoProjectsHero({ onAddProject }: { onAddProject(): void }) {
  return (
    <section aria-label="No projects" className="cv-no-projects">
      <h1 className="cv-no-projects__title">What should we work on?</h1>
      <p className="cv-no-projects__text">Add a project to start your first thread.</p>
      <Button icon={<Plus size={14} />} onClick={onAddProject} variant="primary">
        Add project
      </Button>
    </section>
  );
}
