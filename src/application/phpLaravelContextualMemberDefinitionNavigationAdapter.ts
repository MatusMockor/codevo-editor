import {
  isLaravelEloquentBuilderMethodName,
  phpLaravelScopeMethodName,
} from "../domain/phpFrameworkLaravel";
import { phpLaravelRequestMethodDefinition } from "../domain/phpNavigation";
import type {
  PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";

const ELOQUENT_BUILDER_CLASS_NAME = "Illuminate\\Database\\Eloquent\\Builder";

export const phpLaravelContextualMemberDefinitionNavigationAdapter: PhpFrameworkContextualMemberDefinitionNavigationAdapter =
  {
    supportsBuilderModelNavigation: () => true,
    requestMethodDefinitionHint: phpLaravelRequestMethodDefinition,
    localScopeMethodName: phpLaravelScopeMethodName,
    dynamicWhereTargetClassName: (className) => className,
    staticBuilderTargetClassName: (methodName) => {
      if (!isLaravelEloquentBuilderMethodName(methodName)) {
        return null;
      }

      return ELOQUENT_BUILDER_CLASS_NAME;
    },
  };
