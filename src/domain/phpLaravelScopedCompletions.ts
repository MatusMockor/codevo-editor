import type { EditorPosition } from "./languageServerFeatures";
import { phpLaravelAuthGuardReferenceContextAt } from "./phpLaravelAuth";
import { phpLaravelBroadcastConnectionReferenceContextAt } from "./phpLaravelBroadcasting";
import { phpLaravelCacheStoreReferenceContextAt } from "./phpLaravelCache";
import { phpLaravelConfigReferenceContextAt } from "./phpLaravelConfig";
import { phpLaravelDatabaseConnectionReferenceContextAt } from "./phpLaravelDatabase";
import { phpLaravelEnvReferenceContextAt } from "./phpLaravelEnv";
import { phpLaravelLogChannelReferenceContextAt } from "./phpLaravelLog";
import { phpLaravelMailMailerReferenceContextAt } from "./phpLaravelMail";
import { phpLaravelNamedRouteReferenceContextAt } from "./phpLaravelRoutes";
import { phpLaravelPasswordBrokerReferenceContextAt } from "./phpLaravelPassword";
import { phpLaravelQueueConnectionReferenceContextAt } from "./phpLaravelQueue";
import { phpLaravelRedisConnectionReferenceContextAt } from "./phpLaravelRedis";
import { phpLaravelStorageDiskReferenceContextAt } from "./phpLaravelStorage";
import { phpLaravelTranslationReferenceContextAt } from "./phpLaravelTranslations";
import { phpLaravelValidationRuleStringContextAt } from "./phpLaravelValidation";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";
import { phpLaravelRelationStringCompletionContextAt } from "./phpNavigation";

export function phpLaravelScopedStringCompletionContextAt(
  source: string,
  position: EditorPosition,
): boolean {
  return Boolean(
    phpLaravelNamedRouteReferenceContextAt(source, position) ||
      phpLaravelRelationStringCompletionContextAt(source, position) ||
      phpLaravelTranslationReferenceContextAt(source, position) ||
      phpLaravelEnvReferenceContextAt(source, position) ||
      phpLaravelConfigReferenceContextAt(source, position) ||
      phpLaravelAuthGuardReferenceContextAt(source, position) ||
      phpLaravelCacheStoreReferenceContextAt(source, position) ||
      phpLaravelDatabaseConnectionReferenceContextAt(source, position) ||
      phpLaravelBroadcastConnectionReferenceContextAt(source, position) ||
      phpLaravelQueueConnectionReferenceContextAt(source, position) ||
      phpLaravelRedisConnectionReferenceContextAt(source, position) ||
      phpLaravelMailMailerReferenceContextAt(source, position) ||
      phpLaravelPasswordBrokerReferenceContextAt(source, position) ||
      phpLaravelLogChannelReferenceContextAt(source, position) ||
      phpLaravelStorageDiskReferenceContextAt(source, position) ||
      phpLaravelValidationRuleStringContextAt(source, position) ||
      phpLaravelViewReferenceContextAt(source, position),
  );
}
