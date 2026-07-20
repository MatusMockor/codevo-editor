import { phpNettePresenterLinkCodeActions } from "./phpNettePresenterLinkCodeActions";
import type { PhpFrameworkCodeActionContributionAdapter } from "./phpFrameworkCodeActionContributions";

export const phpNettePresenterLinkCodeActionContribution: PhpFrameworkCodeActionContributionAdapter =
  {
    contributionsFor(provider) {
      if (provider.codeActions?.phpPresenterLinkMethod !== true) {
        return [];
      }

      return [
        {
          id: "nette-presenter-link-method",
          providePhpCodeAction: async (
            source,
            range,
            isRequestedRootActive,
          ) => {
            if (!isRequestedRootActive()) {
              return null;
            }

            return phpNettePresenterLinkCodeActions(source, range);
          },
        },
      ];
    },
    id: "nette-presenter-link-method",
    priority: 90,
  };
