import type { PhpMethodCompletion } from "./phpMethodCompletions";
import type { EditorPosition } from "./languageServerFeatures";
import { firstPhpDocTypeToken, phpDocReturnTypeToken } from "./phpDocTemplates";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "./phpTypeAnalysis";
import { phpExtendsClassName, resolvePhpClassName } from "./phpNavigation";
import { PHP_CLASS_NAME_CAPTURE_PATTERN } from "./phpReceiverExpressions";
import { phpLaravelHigherOrderCollectionProxyElementType } from "./phpLaravelHigherOrderProxy";

const laravelEloquentStaticBuilderMethods = new Set([
  "afterquery",
  "addselect",
  "aggregate",
  "applyafterquerycallbacks",
  "applyscopes",
  "average",
  "avg",
  "beforequery",
  "chunk",
  "chunkbyid",
  "chunkbyiddesc",
  "chunkmap",
  "clone",
  "count",
  "crossjoinsub",
  "cursorpaginate",
  "decrement",
  "decrementeach",
  "delete",
  "doesnthave",
  "doesnthavemorph",
  "doesntexist",
  "doesntexistor",
  "each",
  "eachbyid",
  "exists",
  "existsor",
  "forcedelete",
  "eagerloadrelations",
  "except",
  "fillandinsert",
  "fillandinsertgetid",
  "fillandinsertorignore",
  "fillforinsert",
  "forpage",
  "forpageafterid",
  "forpagebeforeid",
  "forceindex",
  "fromraw",
  "fromsub",
  "getmodels",
  "getquery",
  "getmacro",
  "getglobalmacro",
  "geteagerloads",
  "getlimit",
  "getoffset",
  "getrelation",
  "groupby",
  "groupbyraw",
  "grouplimit",
  "has",
  "hasmacro",
  "hasglobalmacro",
  "hasnamedscope",
  "hasmorph",
  "having",
  "havingbetween",
  "havingnested",
  "havingnotbetween",
  "havingnotnull",
  "havingnull",
  "havingraw",
  "increment",
  "incrementeach",
  "inorderof",
  "inrandomorder",
  "insert",
  "insertgetid",
  "insertorignore",
  "insertorignorereturning",
  "insertorignoreusing",
  "insertusing",
  "ignoreindex",
  "join",
  "joinlateral",
  "joinsub",
  "joinwhere",
  "latest",
  "leftjoin",
  "leftjoinlateral",
  "leftjoinsub",
  "leftjoinwhere",
  "limit",
  "lock",
  "lockforupdate",
  "implode",
  "max",
  "min",
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "numericaggregate",
  "offset",
  "oldest",
  "onlytrashed",
  "orwhere",
  "orwhereall",
  "orwhereany",
  "orwherebelongsto",
  "orwherebetween",
  "orwherebetweencolumns",
  "orwherecolumn",
  "orwheredate",
  "orwhereday",
  "orwhereexists",
  "orwherefuture",
  "orwheredoesnthaverelation",
  "orwheredoesnthave",
  "orwheredoesnthavemorph",
  "orwheremorphdoesnthaverelation",
  "orwherehas",
  "orwherehasmorph",
  "orwherefulltext",
  "orwherein",
  "orwhereintegerinraw",
  "orwhereintegernotinraw",
  "orwheremonth",
  "orwheremorphedto",
  "orwheremorphrelation",
  "orwhererelation",
  "orwherenotin",
  "orwherenotmorphedto",
  "orwherenotnull",
  "orwherenot",
  "orwherenotbetween",
  "orwherenotbetweencolumns",
  "orwherenotexists",
  "orwherenone",
  "orwherenull",
  "orwherenullsafeequals",
  "orwherenoworfuture",
  "orwherenoworpast",
  "orwherepast",
  "orwheretime",
  "orwheretoday",
  "orwhereaftertoday",
  "orwherebeforetoday",
  "orwheretodayorafter",
  "orwheretodayorbefore",
  "orwherevaluebetween",
  "orwherevaluenotbetween",
  "orwherevectordistancelessthan",
  "orwhereyear",
  "orwherejsoncontains",
  "orwherejsoncontainskey",
  "orwherejsondoesntcontain",
  "orwherejsondoesntcontainkey",
  "orwherejsondoesntoverlap",
  "orwherejsonlength",
  "orwherejsonoverlaps",
  "orwherelike",
  "orwherenotlike",
  "orwhereraw",
  "orwhererowvalues",
  "orwhereattachedto",
  "orhaving",
  "orhavingbetween",
  "orhavingnotbetween",
  "orhavingnotnull",
  "orhavingnull",
  "orhavingraw",
  "orhas",
  "orhasmorph",
  "ordoesnthave",
  "ordoesnthavemorph",
  "orderby",
  "orderbydesc",
  "orderbyraw",
  "orderbyvectordistance",
  "orderedchunkbyid",
  "on",
  "onclone",
  "ondelete",
  "onwriteconnection",
  "paginate",
  "paginateusingcursor",
  "pluck",
  "qualifycolumn",
  "qualifycolumns",
  "query",
  "rawvalue",
  "reorder",
  "reorderdesc",
  "restore",
  "rightjoin",
  "rightjoinsub",
  "rightjoinwhere",
  "select",
  "selectexpression",
  "selectraw",
  "selectsub",
  "selectvectordistance",
  "seteagerloads",
  "setquery",
  "sharedlock",
  "simplepaginate",
  "skip",
  "solevalue",
  "scopes",
  "straightjoin",
  "straightjoinsub",
  "straightjoinwhere",
  "sum",
  "take",
  "tobase",
  "touch",
  "timeout",
  "truncate",
  "update",
  "updateorcreate",
  "updatefrom",
  "updateorinsert",
  "union",
  "unionall",
  "upsert",
  "useindex",
  "value",
  "valueorfail",
  "whereall",
  "whereany",
  "wherebetween",
  "wherebetweencolumns",
  "wherecolumn",
  "where",
  "whereattachedto",
  "wherebelongsto",
  "whereraw",
  "wheredoesnthave",
  "wheredoesnthaverelation",
  "wheredoesnthavemorph",
  "wheredate",
  "whereday",
  "whereexists",
  "wherefuture",
  "wherenoworfuture",
  "wherenoworpast",
  "wherepast",
  "wherefulltext",
  "wherehas",
  "wherehasmorph",
  "wherein",
  "whereintegerinraw",
  "whereintegernotinraw",
  "wherejsoncontains",
  "wherejsoncontainskey",
  "wherejsondoesntcontain",
  "wherejsondoesntcontainkey",
  "wherejsondoesntoverlap",
  "wherejsonlength",
  "wherejsonoverlaps",
  "wherekey",
  "wherekeynot",
  "wherelike",
  "wheremonth",
  "wheremorphedto",
  "wheremorphrelation",
  "wheremorphdoesnthaverelation",
  "wherenot",
  "wherenotbetween",
  "wherenotbetweencolumns",
  "wherenotexists",
  "wherenotin",
  "wherenotlike",
  "wherenotmorphedto",
  "wherenotnull",
  "wherenull",
  "wherenullsafeequals",
  "wherenone",
  "whererelation",
  "whererowvalues",
  "wheretime",
  "wheretoday",
  "whereaftertoday",
  "wherebeforetoday",
  "wheretodayorafter",
  "wheretodayorbefore",
  "wherevaluebetween",
  "wherevaluenotbetween",
  "wherevectordistancelessthan",
  "wherevectorsimilarto",
  "whereyear",
  "with",
  "withaggregate",
  "withattributes",
  "withavg",
  "withcasts",
  "withcount",
  "withexists",
  "withmax",
  "withmin",
  "withrelations",
  "withsum",
  "withwherehas",
  "withwhererelation",
  "withsavepointifneeded",
  "withglobalscope",
  "withonly",
  "withtrashed",
  "without",
  "withouteagerload",
  "withouteagerloads",
  "withoutglobalscope",
  "withoutglobalscopes",
  "withoutglobalscopesexcept",
  "withouttrashed",
]);

const laravelEloquentBuilderFluentMethods = new Set([
  "afterquery",
  "addselect",
  "aggregate",
  "applyafterquerycallbacks",
  "applyscopes",
  "average",
  "avg",
  "beforequery",
  "chunk",
  "chunkbyid",
  "chunkbyiddesc",
  "chunkmap",
  "clone",
  "count",
  "crossjoinsub",
  "cursorpaginate",
  "decrement",
  "decrementeach",
  "delete",
  "doesnthave",
  "doesnthavemorph",
  "doesntexist",
  "doesntexistor",
  "each",
  "eachbyid",
  "exists",
  "existsor",
  "forcedelete",
  "eagerloadrelations",
  "except",
  "fillandinsert",
  "fillandinsertgetid",
  "fillandinsertorignore",
  "fillforinsert",
  "forpage",
  "forpageafterid",
  "forpagebeforeid",
  "forceindex",
  "fromraw",
  "fromsub",
  "getmodels",
  "getquery",
  "getmacro",
  "getglobalmacro",
  "geteagerloads",
  "getlimit",
  "getoffset",
  "getrelation",
  "groupby",
  "groupbyraw",
  "grouplimit",
  "has",
  "hasmacro",
  "hasglobalmacro",
  "hasnamedscope",
  "hasmorph",
  "having",
  "havingbetween",
  "havingnested",
  "havingnotbetween",
  "havingnotnull",
  "havingnull",
  "havingraw",
  "increment",
  "incrementeach",
  "inorderof",
  "inrandomorder",
  "insert",
  "insertgetid",
  "insertorignore",
  "insertorignorereturning",
  "insertorignoreusing",
  "insertusing",
  "ignoreindex",
  "join",
  "joinlateral",
  "joinsub",
  "joinwhere",
  "latest",
  "leftjoin",
  "leftjoinlateral",
  "leftjoinsub",
  "leftjoinwhere",
  "limit",
  "lock",
  "lockforupdate",
  "implode",
  "max",
  "min",
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "numericaggregate",
  "offset",
  "oldest",
  "onlytrashed",
  "orwhere",
  "orwhereall",
  "orwhereany",
  "orwherebelongsto",
  "orwherebetween",
  "orwherebetweencolumns",
  "orwherecolumn",
  "orwheredate",
  "orwhereday",
  "orwhereexists",
  "orwherefuture",
  "orwheredoesnthaverelation",
  "orwheredoesnthave",
  "orwheredoesnthavemorph",
  "orwheremorphdoesnthaverelation",
  "orwherehas",
  "orwherehasmorph",
  "orwherefulltext",
  "orwherein",
  "orwhereintegerinraw",
  "orwhereintegernotinraw",
  "orwheremonth",
  "orwheremorphedto",
  "orwheremorphrelation",
  "orwhererelation",
  "orwherenotin",
  "orwherenotmorphedto",
  "orwherenotnull",
  "orwherenot",
  "orwherenotbetween",
  "orwherenotbetweencolumns",
  "orwherenotexists",
  "orwherenone",
  "orwherenull",
  "orwherenullsafeequals",
  "orwherenoworfuture",
  "orwherenoworpast",
  "orwherepast",
  "orwheretime",
  "orwheretoday",
  "orwhereaftertoday",
  "orwherebeforetoday",
  "orwheretodayorafter",
  "orwheretodayorbefore",
  "orwherevaluebetween",
  "orwherevaluenotbetween",
  "orwherevectordistancelessthan",
  "orwhereyear",
  "orwherejsoncontains",
  "orwherejsoncontainskey",
  "orwherejsondoesntcontain",
  "orwherejsondoesntcontainkey",
  "orwherejsondoesntoverlap",
  "orwherejsonlength",
  "orwherejsonoverlaps",
  "orwherelike",
  "orwherenotlike",
  "orwhereraw",
  "orwhererowvalues",
  "orwhereattachedto",
  "orhaving",
  "orhavingbetween",
  "orhavingnotbetween",
  "orhavingnotnull",
  "orhavingnull",
  "orhavingraw",
  "orhas",
  "orhasmorph",
  "ordoesnthave",
  "ordoesnthavemorph",
  "orderby",
  "orderbydesc",
  "orderbyraw",
  "orderbyvectordistance",
  "orderedchunkbyid",
  "on",
  "onclone",
  "ondelete",
  "onwriteconnection",
  "paginate",
  "paginateusingcursor",
  "pluck",
  "qualifycolumn",
  "qualifycolumns",
  "rawvalue",
  "reorder",
  "reorderdesc",
  "restore",
  "rightjoin",
  "rightjoinsub",
  "rightjoinwhere",
  "select",
  "selectexpression",
  "selectraw",
  "selectsub",
  "selectvectordistance",
  "seteagerloads",
  "setquery",
  "sharedlock",
  "simplepaginate",
  "skip",
  "solevalue",
  "scopes",
  "straightjoin",
  "straightjoinsub",
  "straightjoinwhere",
  "sum",
  "take",
  "tap",
  "tobase",
  "touch",
  "timeout",
  "truncate",
  "update",
  "updateorcreate",
  "updatefrom",
  "updateorinsert",
  "unless",
  "union",
  "unionall",
  "upsert",
  "useindex",
  "value",
  "valueorfail",
  "when",
  "whereall",
  "whereany",
  "where",
  "wherebelongsto",
  "whereattachedto",
  "wherebetween",
  "wherebetweencolumns",
  "wherecolumn",
  "whereraw",
  "wheredoesnthave",
  "wheredoesnthaverelation",
  "wheredoesnthavemorph",
  "wheredate",
  "whereday",
  "whereexists",
  "wherefuture",
  "wherenoworfuture",
  "wherenoworpast",
  "wherepast",
  "wherefulltext",
  "wherehas",
  "wherehasmorph",
  "wherein",
  "whereintegerinraw",
  "whereintegernotinraw",
  "wherejsoncontains",
  "wherejsoncontainskey",
  "wherejsondoesntcontain",
  "wherejsondoesntcontainkey",
  "wherejsondoesntoverlap",
  "wherejsonlength",
  "wherejsonoverlaps",
  "wherekey",
  "wherekeynot",
  "wherelike",
  "wheremonth",
  "wheremorphedto",
  "wheremorphrelation",
  "wheremorphdoesnthaverelation",
  "wherenot",
  "wherenotbetween",
  "wherenotbetweencolumns",
  "wherenotexists",
  "wherenotin",
  "wherenotlike",
  "wherenotmorphedto",
  "wherenotnull",
  "wherenull",
  "wherenullsafeequals",
  "wherenone",
  "whererelation",
  "whererowvalues",
  "wheretime",
  "wheretoday",
  "whereaftertoday",
  "wherebeforetoday",
  "wheretodayorafter",
  "wheretodayorbefore",
  "wherevaluebetween",
  "wherevaluenotbetween",
  "wherevectordistancelessthan",
  "wherevectorsimilarto",
  "whereyear",
  "with",
  "withaggregate",
  "withattributes",
  "withavg",
  "withcasts",
  "withcount",
  "withexists",
  "withmax",
  "withmin",
  "withrelations",
  "withsum",
  "withwherehas",
  "withwhererelation",
  "withsavepointifneeded",
  "withglobalscope",
  "withonly",
  "withtrashed",
  "without",
  "withouteagerload",
  "withouteagerloads",
  "withoutglobalscope",
  "withoutglobalscopes",
  "withoutglobalscopesexcept",
  "withouttrashed",
]);

const laravelEloquentBuilderTerminalModelMethods = new Set([
  "create",
  "createorfirst",
  "createorrestore",
  "createquietly",
  "find",
  "findor",
  "findorfail",
  "findornew",
  "findsole",
  "first",
  "firstor",
  "firstorcreate",
  "firstorfail",
  "firstornew",
  "firstwhere",
  "forcecreate",
  "forcecreatequietly",
  "getmodel",
  "incrementorcreate",
  "make",
  "newmodelinstance",
  "restoreorcreate",
  "sole",
  "updateorcreate",
]);

const laravelEloquentBuilderCollectionMethods = new Set([
  "all",
  "cursor",
  "findmany",
  "fromquery",
  "get",
  "hydrate",
  "lazy",
  "lazybyid",
  "lazybyiddesc",
  "orderedlazybyid",
]);

const laravelEloquentBuilderLazyCollectionMethods = new Set([
  "cursor",
  "lazy",
  "lazybyid",
  "lazybyiddesc",
  "orderedlazybyid",
]);

const laravelEloquentBuilderNonModelTerminalMethods = new Set([
  "aggregate",
  "applyafterquerycallbacks",
  "average",
  "avg",
  "chunk",
  "chunkbyid",
  "chunkbyiddesc",
  "chunkmap",
  "count",
  "cursorpaginate",
  "decrement",
  "decrementeach",
  "delete",
  "doesntexist",
  "doesntexistor",
  "each",
  "eachbyid",
  "exists",
  "existsor",
  "eagerloadrelations",
  "fillandinsert",
  "fillandinsertgetid",
  "fillandinsertorignore",
  "fillforinsert",
  "forcedelete",
  "geteagerloads",
  "getglobalmacro",
  "getlimit",
  "getmacro",
  "getmodels",
  "getoffset",
  "getquery",
  "getrelation",
  "hasglobalmacro",
  "hasmacro",
  "hasnamedscope",
  "implode",
  "increment",
  "incrementeach",
  "insert",
  "insertgetid",
  "insertorignore",
  "insertorignorereturning",
  "insertorignoreusing",
  "insertusing",
  "max",
  "min",
  "numericaggregate",
  "orderedchunkbyid",
  "ondelete",
  "paginate",
  "paginateusingcursor",
  "pluck",
  "qualifycolumn",
  "qualifycolumns",
  "rawvalue",
  "restore",
  "simplepaginate",
  "solevalue",
  "sum",
  "tobase",
  "touch",
  "truncate",
  "update",
  "updatefrom",
  "updateorinsert",
  "upsert",
  "value",
  "valueorfail",
  "withsavepointifneeded",
]);

const laravelEloquentModelBuilderFactoryMethods = new Set([
  "newmodelquery",
  "newquery",
  "newquerywithoutrelationships",
  "newquerywithoutscopes",
  "on",
  "onwriteconnection",
  "query",
]);

const laravelEloquentModelFluentMethods = new Set([
  "append",
  "load",
  "loadaggregate",
  "loadavg",
  "loadcount",
  "loadexists",
  "loadmax",
  "loadmin",
  "loadmissing",
  "loadmorph",
  "loadmorphaggregate",
  "loadmorphavg",
  "loadmorphcount",
  "loadmorphmax",
  "loadmorphmin",
  "loadmorphsum",
  "loadsum",
  "makehidden",
  "makehiddenif",
  "makevisible",
  "makevisibleif",
  "setappends",
  "sethidden",
  "setvisible",
]);

const laravelDatabaseQueryBuilderFactoryMethods = new Set(["table"]);

const laravelDatabaseQueryBuilderFluentMethods = new Set([
  "addselect",
  "afterquery",
  "beforequery",
  "crossjoin",
  "crossjoinsub",
  "distinct",
  "from",
  "forceindex",
  "forpage",
  "forpageafterid",
  "forpagebeforeid",
  "fromraw",
  "fromsub",
  "groupby",
  "groupbyraw",
  "grouplimit",
  "having",
  "havingbetween",
  "havingnested",
  "havingnotbetween",
  "havingnotnull",
  "havingnull",
  "havingraw",
  "inrandomorder",
  "inorderof",
  "ignoreindex",
  "join",
  "joinlateral",
  "joinsub",
  "joinwhere",
  "latest",
  "leftjoin",
  "leftjoinlateral",
  "leftjoinsub",
  "leftjoinwhere",
  "limit",
  "lock",
  "lockforupdate",
  "offset",
  "oldest",
  "orderby",
  "orderbydesc",
  "orderbyraw",
  "orderbyvectordistance",
  "orwhere",
  "orwhereall",
  "orwhereany",
  "orwherebetween",
  "orwherebetweencolumns",
  "orwherecolumn",
  "orwheredate",
  "orwhereday",
  "orwhereexists",
  "orwherefuture",
  "orwherefulltext",
  "orwherein",
  "orwhereintegerinraw",
  "orwhereintegernotinraw",
  "orwheremonth",
  "orwherenot",
  "orwherenotbetween",
  "orwherenotbetweencolumns",
  "orwherenotexists",
  "orwherenone",
  "orwherenotin",
  "orwherenotnull",
  "orwherenull",
  "orwherenullsafeequals",
  "orwherenoworfuture",
  "orwherenoworpast",
  "orwherepast",
  "orwhereraw",
  "orwhererowvalues",
  "orwheretime",
  "orwheretoday",
  "orwhereaftertoday",
  "orwherebeforetoday",
  "orwheretodayorafter",
  "orwheretodayorbefore",
  "orwherevaluebetween",
  "orwherevaluenotbetween",
  "orwherevectordistancelessthan",
  "orwhereyear",
  "orwherejsoncontains",
  "orwherejsoncontainskey",
  "orwherejsondoesntcontain",
  "orwherejsondoesntcontainkey",
  "orwherejsondoesntoverlap",
  "orwherejsonlength",
  "orwherejsonoverlaps",
  "orwherelike",
  "orwherenotlike",
  "orhaving",
  "orhavingbetween",
  "orhavingnotbetween",
  "orhavingnotnull",
  "orhavingnull",
  "orhavingraw",
  "reorder",
  "reorderdesc",
  "rightjoin",
  "rightjoinsub",
  "rightjoinwhere",
  "select",
  "selectexpression",
  "selectraw",
  "selectsub",
  "selectvectordistance",
  "sharedlock",
  "skip",
  "straightjoin",
  "straightjoinsub",
  "straightjoinwhere",
  "take",
  "tap",
  "timeout",
  "unless",
  "union",
  "unionall",
  "useindex",
  "when",
  "where",
  "whereall",
  "whereany",
  "wherebetween",
  "wherebetweencolumns",
  "wherecolumn",
  "wheredate",
  "whereday",
  "whereexists",
  "wherefuture",
  "wherenoworfuture",
  "wherenoworpast",
  "wherepast",
  "wherefulltext",
  "wherein",
  "whereintegerinraw",
  "whereintegernotinraw",
  "wherejsoncontains",
  "wherejsoncontainskey",
  "wherejsondoesntcontain",
  "wherejsondoesntcontainkey",
  "wherejsondoesntoverlap",
  "wherejsonlength",
  "wherejsonoverlaps",
  "wherelike",
  "wheremonth",
  "wherenot",
  "wherenotbetween",
  "wherenotbetweencolumns",
  "wherenotexists",
  "wherenotin",
  "wherenotlike",
  "wherenotnull",
  "wherenull",
  "wherenullsafeequals",
  "wherenone",
  "whereraw",
  "whererowvalues",
  "wheretime",
  "wheretoday",
  "whereaftertoday",
  "wherebeforetoday",
  "wheretodayorafter",
  "wheretodayorbefore",
  "wherevaluebetween",
  "wherevaluenotbetween",
  "wherevectordistancelessthan",
  "wherevectorsimilarto",
  "whereyear",
]);

const laravelDatabaseConnectionTypes = new Set([
  "illuminate\\database\\connection",
  "illuminate\\database\\connectioninterface",
  "illuminate\\database\\databasemanager",
]);

const laravelDatabaseQueryBuilderTypes = new Set([
  "illuminate\\database\\query\\builder",
]);

const laravelCollectionTerminalModelMethods = new Set([
  "find",
  "first",
  "firstorfail",
  "firstwhere",
  "last",
  "sole",
]);

const laravelCollectionFluentMethods = new Set([
  "filter",
  "forpage",
  "keyby",
  "load",
  "loadaggregate",
  "loadavg",
  "loadcount",
  "loadexists",
  "loadmax",
  "loadmin",
  "loadmissing",
  "loadmorph",
  "loadmorphcount",
  "loadsum",
  "only",
  "reject",
  "reverse",
  "skip",
  "slice",
  "sort",
  "sortby",
  "sortbydesc",
  "take",
  "unique",
  "values",
  "where",
  "wherebetween",
  "wherein",
  "whereinstanceof",
  "wherenotin",
  "wherenotnull",
  "wherenull",
]);

const laravelRepositoryModelReturnMethods = new Set([
  "find",
  "findorfail",
  "first",
  "firstorcreate",
  "firstorfail",
  "firstornew",
  "sole",
  "updateorcreate",
]);

const laravelEloquentRelationTypes = new Set([
  "belongsto",
  "belongstomany",
  "hasmany",
  "hasmanythrough",
  "hasone",
  "hasonethrough",
  "morphmany",
  "morphone",
  "morphedbymany",
  "morphto",
  "morphtomany",
]);

const laravelEloquentSingularRelationTypes = new Set([
  "belongsto",
  "hasone",
  "hasonethrough",
  "morphone",
  "morphto",
]);

const laravelEloquentFirstGenericRelationTypes = new Set([
  "belongsto",
  "belongstomany",
  "hasmany",
  "hasmanythrough",
  "hasone",
  "hasonethrough",
  "morphmany",
  "morphone",
  "morphedbymany",
  "morphtomany",
]);

const laravelEloquentRelationFactoryClassNames = new Map([
  ["belongsto", "BelongsTo"],
  ["belongstomany", "BelongsToMany"],
  ["hasmany", "HasMany"],
  ["hasmanythrough", "HasManyThrough"],
  ["hasone", "HasOne"],
  ["hasonethrough", "HasOneThrough"],
  ["morphmany", "MorphMany"],
  ["morphone", "MorphOne"],
  ["morphedbymany", "MorphedByMany"],
  ["morphto", "MorphTo"],
  ["morphtomany", "MorphToMany"],
]);

const laravelEloquentRelationFluentMethods = new Set([
  "as",
  "chaperone",
  "latestofmany",
  "ofmany",
  "oldestofmany",
  "orderbypivot",
  "onlytrashed",
  "using",
  "withdefault",
  "withtrashed",
  "wherepivot",
  "wherepivotbetween",
  "wherepivotin",
  "wherepivotnotbetween",
  "wherepivotnotin",
  "wherepivotnotnull",
  "wherepivotnull",
  "withpivot",
  "withpivotvalue",
  "withtimestamps",
  "withouttrashed",
]);

export interface PhpLaravelDynamicWhereAttributeTarget {
  attributeName: string;
  position: EditorPosition;
}

export interface PhpLaravelContainerBinding {
  abstractClassName: string;
  concreteClassName: string;
}

interface PhpLaravelContainerBindingMatch extends PhpLaravelContainerBinding {
  offset: number;
}

export interface PhpLaravelMorphMapEntry {
  alias: string;
  modelClassName: string;
}

export function isLaravelEloquentStaticBuilderMethod(methodName: string): boolean {
  return laravelEloquentStaticBuilderMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderFluentMethod(methodName: string): boolean {
  return laravelEloquentBuilderFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderTerminalModelMethod(
  methodName: string,
): boolean {
  return laravelEloquentBuilderTerminalModelMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderCollectionMethod(
  methodName: string,
): boolean {
  return laravelEloquentBuilderCollectionMethods.has(methodName.toLowerCase());
}

function isLaravelEloquentBuilderPreservingMethod(methodName: string): boolean {
  const normalizedMethodName = methodName.toLowerCase();

  return (
    (laravelEloquentBuilderFluentMethods.has(normalizedMethodName) ||
      laravelEloquentModelBuilderFactoryMethods.has(normalizedMethodName)) &&
    !laravelEloquentBuilderTerminalModelMethods.has(normalizedMethodName) &&
    !laravelEloquentBuilderCollectionMethods.has(normalizedMethodName) &&
    !laravelEloquentBuilderNonModelTerminalMethods.has(normalizedMethodName)
  );
}

export function isLaravelEloquentModelBuilderFactoryMethod(
  methodName: string,
): boolean {
  return laravelEloquentModelBuilderFactoryMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentModelFluentMethod(methodName: string): boolean {
  return laravelEloquentModelFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentRelationFluentMethod(
  methodName: string,
): boolean {
  return laravelEloquentRelationFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseQueryBuilderFactoryMethod(
  methodName: string,
): boolean {
  return laravelDatabaseQueryBuilderFactoryMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseQueryBuilderFluentMethod(
  methodName: string,
): boolean {
  return laravelDatabaseQueryBuilderFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelDatabaseConnectionType(className: string): boolean {
  return laravelDatabaseConnectionTypes.has(normalizedLaravelClassName(className));
}

export function isLaravelDatabaseQueryBuilderType(className: string): boolean {
  return laravelDatabaseQueryBuilderTypes.has(normalizedLaravelClassName(className));
}

export function isLaravelCollectionTerminalModelMethod(
  methodName: string,
): boolean {
  return laravelCollectionTerminalModelMethods.has(methodName.toLowerCase());
}

export function isLaravelCollectionFluentMethod(methodName: string): boolean {
  return laravelCollectionFluentMethods.has(methodName.toLowerCase());
}

export function isLaravelEloquentBuilderMethodName(methodName: string): boolean {
  return (
    isLaravelEloquentStaticBuilderMethod(methodName) ||
    isLaravelEloquentBuilderFluentMethod(methodName) ||
    isLaravelEloquentBuilderTerminalModelMethod(methodName) ||
    isLaravelEloquentBuilderCollectionMethod(methodName)
  );
}

export function isLaravelEloquentBuilderMacroFromSource(
  source: string,
  methodName: string,
  workspaceSources: readonly string[] = [],
): boolean {
  return Boolean(
    phpLaravelEloquentBuilderMacroFromSource(
      source,
      methodName,
      workspaceSources,
    ),
  );
}

export function isLaravelMacroMemberMethodFromSource(
  source: string,
  receiverExpression: string,
  receiverClassName: string | null,
  methodName: string,
  workspaceSources: readonly string[] = [],
): boolean {
  const lookupName = methodName.trim().toLowerCase();

  if (!lookupName) {
    return false;
  }

  const resolvedReceiverClassName =
    receiverClassName ??
    phpLaravelMacroReceiverClassNameFromExpression(receiverExpression);

  if (!resolvedReceiverClassName) {
    return false;
  }

  const receiverRegistrarClassNames = laravelMacroReceiverRegistrarClassNames(
    source,
    resolvedReceiverClassName,
  );

  if (!receiverRegistrarClassNames) {
    return false;
  }

  return phpLaravelMacrosFromSources(source, workspaceSources).some(
    (macro) =>
      receiverRegistrarClassNames.has(macro.registrarClassName) &&
      macro.name.toLowerCase() === lookupName,
  );
}

export function phpLaravelMacroCompletionsFromSource(
  source: string,
  declaringClassName: string,
  workspaceSources: readonly string[] = [],
): PhpMethodCompletion[] {
  const registrarClassNames = laravelMacroReceiverRegistrarClassNames(
    source,
    declaringClassName,
  );

  if (!registrarClassNames) {
    return [];
  }

  return phpLaravelMacrosFromSources(source, workspaceSources)
    .filter((macro) => registrarClassNames.has(macro.registrarClassName))
    .map((macro) => ({
      declaringClassName,
      name: macro.name,
      parameters: macro.parameters,
      returnType: macro.returnType,
    }));
}

export function isLaravelEloquentStaticBuilderReceiver(
  source: string,
  className: string,
): boolean {
  const resolvedClassName = phpLaravelResolvedClassName(source, className);

  return Boolean(resolvedClassName && isLaravelModelType(resolvedClassName));
}

export function isLaravelEloquentLocalScopeStaticMethod(
  source: string,
  className: string,
  methodName: string,
): boolean {
  const modelType = phpLaravelResolvedModelTypeCandidate(source, className);

  return Boolean(
    modelType && phpLaravelModelHasLocalScope(source, modelType, methodName),
  );
}

export function isLaravelEloquentLocalScopeMemberMethod(
  source: string,
  receiverExpression: string,
  methodName: string,
): boolean {
  const modelType = phpLaravelEloquentBuilderModelTypeFromExpression(
    source,
    receiverExpression,
  );

  return Boolean(
    modelType && phpLaravelModelHasLocalScope(source, modelType, methodName),
  );
}

export function phpLaravelEloquentBuilderModelTypeCandidate(
  source: string,
  typeName: string | null,
): string | null {
  if (!phpLaravelGenericCarrierMatches(source, typeName, [
    "builder",
    "illuminate\\database\\eloquent\\builder",
  ])) {
    return null;
  }

  return phpLaravelGenericModelTypeCandidate(typeName);
}

export function phpLaravelCollectionModelTypeCandidate(
  source: string,
  typeName: string | null,
): string | null {
  if (!phpLaravelGenericCarrierMatches(source, typeName, [
    "collection",
    "illuminate\\database\\eloquent\\collection",
    "illuminate\\support\\collection",
    "illuminate\\support\\lazycollection",
  ])) {
    return null;
  }

  return phpLaravelGenericModelTypeCandidate(typeName);
}

export function phpLaravelRepositoryConventionModelTypeFromCarrierReturnType(
  source: string,
  receiverType: string | null,
  returnType: string | null,
  carrierKind: "builder" | "collection",
): string | null {
  const acceptedCarriers =
    carrierKind === "builder"
      ? ["builder", "illuminate\\database\\eloquent\\builder"]
      : [
          "collection",
          "illuminate\\database\\eloquent\\collection",
          "illuminate\\support\\collection",
          "illuminate\\support\\lazycollection",
        ];

  return phpLaravelGenericCarrierMatches(source, returnType, acceptedCarriers)
    ? phpLaravelRepositoryConventionModelTypeFromReceiver(source, receiverType)
    : null;
}

export function phpLaravelRepositoryMethodModelReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  if (
    !laravelRepositoryModelReturnMethods.has(methodName.toLowerCase()) ||
    !isLaravelRepositoryType(receiverType)
  ) {
    return null;
  }

  const receiverClassName = phpLaravelResolvedClassName(source, receiverType ?? "");
  const returnTypes = [
    ...phpLaravelRepositoryDeclaredMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
    ...phpLaravelRepositoryPhpDocMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
  ];

  return returnTypes
    .map((returnType) => phpLaravelModelTypeFromReturnType(source, returnType))
    .find((returnType): returnType is string => Boolean(returnType)) ??
    phpLaravelRepositoryGenericInheritanceModelTypeFromReceiver(
      source,
      receiverType,
    ) ??
    phpLaravelRepositoryConventionModelTypeFromReceiver(source, receiverType);
}

export function phpLaravelMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  callExpression: string | null = null,
  workspaceSources: readonly string[] = [],
): string | null {
  return (
    phpLaravelRepositoryMethodModelReturnTypeFromSource(
      source,
      methodName,
      receiverType,
    ) ??
    phpLaravelRepositoryMethodBuilderReturnTypeFromSource(
      source,
      methodName,
      receiverType,
    ) ??
    phpLaravelRepositoryMethodCollectionReturnTypeFromSource(
      source,
      methodName,
      receiverType,
    ) ??
    phpLaravelCollectionMethodCallReturnTypeFromSource(
      source,
      methodName,
      receiverType,
    ) ??
    phpLaravelEloquentMethodCallReturnTypeFromSource(
      source,
      methodName,
      receiverType,
      receiverExpression,
      callExpression,
      workspaceSources,
    )
  );
}

export function phpLaravelContainerExpressionClassName(
  expression: string,
): string | null {
  const normalized = expression.trim();
  const helperMatch = new RegExp(
    `^(?:app|resolve|make)\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
  ).exec(normalized);

  if (helperMatch && phpLaravelContainerCallIsOutermost(normalized, helperMatch)) {
    return helperMatch[1]?.replace(/^\\+/, "") ?? null;
  }

  const makeMatch = new RegExp(
    `(?:->|::)(?:make|makeWith)\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
  ).exec(normalized);

  if (makeMatch && phpLaravelContainerCallIsOutermost(normalized, makeMatch)) {
    return makeMatch[1]?.replace(/^\\+/, "") ?? null;
  }

  return null;
}

// The resolved instance is the expression type only when the container call is
// the OUTERMOST operation. For `app()->make(X::class)->paginate()` the type is
// `paginate()`'s return, not `X`, so we must not claim the container class when a
// trailing call follows the resolution. Anchor on the container call's own
// argument list and require nothing but whitespace after its closing paren.
function phpLaravelContainerCallIsOutermost(
  expression: string,
  match: RegExpExecArray,
): boolean {
  const openOffset = (match.index ?? 0) + match[0].indexOf("(");

  if (expression[openOffset] !== "(") {
    return false;
  }

  const closeOffset = matchingPairOffset(expression, openOffset, "(", ")");

  if (closeOffset === null) {
    return false;
  }

  return expression.slice(closeOffset + 1).trim().length === 0;
}

export function phpLaravelContainerBindingsFromSource(
  source: string,
): PhpLaravelContainerBinding[] {
  const bindings: PhpLaravelContainerBindingMatch[] = [];
  const pushBinding = (
    abstractClassName: string | null,
    concreteClassName: string | null,
    offset: number,
  ) => {
    if (!abstractClassName || !concreteClassName) {
      return;
    }

    if (
      bindings.some(
        (binding) =>
          binding.abstractClassName === abstractClassName &&
          binding.concreteClassName === concreteClassName,
      )
    ) {
      return;
    }

    bindings.push({ abstractClassName, concreteClassName, offset });
  };
  const directBindingPattern = new RegExp(
    `(?:->|::)(?:bind|singleton|scoped)\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\s*,\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class`,
    "g",
  );
  const contextualBindingPattern = new RegExp(
    `->\\s*needs\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\s*\\)\\s*->\\s*give\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class`,
    "g",
  );

  for (const match of source.matchAll(directBindingPattern)) {
    const abstractClassName = match[1]?.replace(/^\\+/, "");
    const concreteClassName = match[2]?.replace(/^\\+/, "");

    pushBinding(abstractClassName, concreteClassName, match.index ?? 0);
  }

  for (const match of source.matchAll(contextualBindingPattern)) {
    const abstractClassName = match[1]?.replace(/^\\+/, "");
    const concreteClassName = match[2]?.replace(/^\\+/, "");

    pushBinding(abstractClassName, concreteClassName, match.index ?? 0);
  }

  for (const binding of phpLaravelContainerFactoryBindingsFromSource(source)) {
    pushBinding(
      binding.abstractClassName,
      binding.concreteClassName,
      binding.offset,
    );
  }

  for (const binding of phpLaravelContextualFactoryBindingsFromSource(source)) {
    pushBinding(
      binding.abstractClassName,
      binding.concreteClassName,
      binding.offset,
    );
  }

  return bindings
    .sort((left, right) => left.offset - right.offset)
    .map(({ abstractClassName, concreteClassName }) => ({
      abstractClassName,
      concreteClassName,
    }));
}

function phpLaravelContainerFactoryBindingsFromSource(
  source: string,
): PhpLaravelContainerBindingMatch[] {
  const bindings: PhpLaravelContainerBindingMatch[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = /(?:->|::)(?:bind|singleton|scoped)\s*\(/g;

  for (const match of masked.matchAll(pattern)) {
    const openOffset = masked.indexOf("(", match.index);

    if (openOffset < 0) {
      continue;
    }

    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (closeOffset === null) {
      continue;
    }

    const [abstractArgument, concreteArgument] = splitPhpParameterList(
      source.slice(openOffset + 1, closeOffset),
    );
    const abstractClassName = phpLaravelClassNameLiteral(abstractArgument ?? "");
    const concreteClassName = phpLaravelFactoryConcreteClassName(
      concreteArgument ?? "",
    );

    if (abstractClassName && concreteClassName) {
      bindings.push({
        abstractClassName,
        concreteClassName,
        offset: match.index ?? 0,
      });
    }
  }

  return bindings;
}

function phpLaravelContextualFactoryBindingsFromSource(
  source: string,
): PhpLaravelContainerBindingMatch[] {
  const bindings: PhpLaravelContainerBindingMatch[] = [];
  const masked = maskPhpStringsAndComments(source);
  const needsPattern = /->\s*needs\s*\(/g;

  for (const match of masked.matchAll(needsPattern)) {
    const needsOpenOffset = masked.indexOf("(", match.index);

    if (needsOpenOffset < 0) {
      continue;
    }

    const needsCloseOffset = matchingPairOffset(
      source,
      needsOpenOffset,
      "(",
      ")",
    );

    if (needsCloseOffset === null) {
      continue;
    }

    const abstractClassName = phpLaravelClassNameLiteral(
      source.slice(needsOpenOffset + 1, needsCloseOffset),
    );

    if (!abstractClassName) {
      continue;
    }

    const giveMatch = /^\s*->\s*give\s*\(/.exec(
      masked.slice(needsCloseOffset + 1),
    );

    if (!giveMatch) {
      continue;
    }

    const giveOpenOffset =
      needsCloseOffset + 1 + giveMatch[0].lastIndexOf("(");
    const giveCloseOffset = matchingPairOffset(source, giveOpenOffset, "(", ")");

    if (giveCloseOffset === null) {
      continue;
    }

    const concreteClassName = phpLaravelFactoryConcreteClassName(
      source.slice(giveOpenOffset + 1, giveCloseOffset),
    );

    if (concreteClassName) {
      bindings.push({
        abstractClassName,
        concreteClassName,
        offset: match.index ?? 0,
      });
    }
  }

  return bindings;
}

function phpLaravelClassNameLiteral(expression: string): string | null {
  const match = new RegExp(
    `^\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
  ).exec(expression);

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

function phpLaravelFactoryConcreteClassName(expression: string): string | null {
  return (
    phpLaravelClassNameLiteral(expression) ??
    new RegExp(`\\bnew\\s+${PHP_CLASS_NAME_CAPTURE_PATTERN}\\b`).exec(
      expression,
    )?.[1]?.replace(/^\\+/, "") ??
    null
  );
}

export function phpLaravelMorphMapEntriesFromSource(
  source: string,
): PhpLaravelMorphMapEntry[] {
  const entries: PhpLaravelMorphMapEntry[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    String.raw`\b` +
      PHP_CLASS_NAME_CAPTURE_PATTERN +
      String.raw`\s*::\s*(?:morphMap|enforceMorphMap)\s*\(`,
    "g",
  );

  for (const match of masked.matchAll(pattern)) {
    const relationClassName = match[1] ?? "";

    if (!phpLaravelRelationClassReference(source, relationClassName)) {
      continue;
    }

    const openOffset = (match.index ?? 0) + (match[0]?.lastIndexOf("(") ?? -1);
    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (openOffset < (match.index ?? 0) || closeOffset === null) {
      continue;
    }

    const mapBody = phpLaravelMorphMapArrayBody(
      source,
      source.slice(openOffset + 1, closeOffset),
    );

    if (!mapBody) {
      continue;
    }

    entries.push(...phpLaravelMorphMapEntriesFromArrayBody(source, mapBody));
  }

  return entries;
}

function phpLaravelMorphMapModelTypeFromSource(source: string): string | null {
  const modelTypes = new Set(
    phpLaravelMorphMapEntriesFromSource(source).map((entry) =>
      entry.modelClassName.replace(/^\\+/, ""),
    ),
  );

  return modelTypes.size === 1 ? Array.from(modelTypes)[0] ?? null : null;
}

function phpLaravelMorphMapModelDisplayTypeFromSource(source: string): string | null {
  const modelTypes = Array.from(
    new Set(
      phpLaravelMorphMapEntriesFromSource(source).map((entry) =>
        entry.modelClassName.replace(/^\\+/, ""),
      ),
    ),
  );

  return modelTypes.length > 1 ? modelTypes.join("|") : null;
}

function phpLaravelRelationClassReference(
  source: string,
  className: string,
): boolean {
  const resolvedClassName =
    resolvePhpClassName(source, className)?.replace(/^\\+/, "") ??
    className.replace(/^\\+/, "");
  const normalized = resolvedClassName.toLowerCase();

  return (
    normalized === "relation" ||
    normalized === "illuminate\\database\\eloquent\\relations\\relation"
  );
}

function phpLaravelMorphMapArrayBody(
  source: string,
  argumentsSource: string,
): string | null {
  for (const [index, argument] of splitPhpParameterList(
    argumentsSource,
  ).entries()) {
    const namedArgumentMatch =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(argument);
    const argumentName = namedArgumentMatch?.[1]?.toLowerCase() ?? null;
    const value = (namedArgumentMatch?.[2] ?? argument).trim();

    if (argumentName && argumentName !== "map") {
      continue;
    }

    if (!argumentName && index > 0) {
      continue;
    }

    const body = phpArrayExpressionBody(value);

    if (body !== null) {
      return body;
    }

    const constantBody = phpLaravelMorphMapArrayConstantBody(source, value);

    if (constantBody !== null) {
      return constantBody;
    }
  }

  return null;
}

function phpLaravelMorphMapArrayConstantBody(
  source: string,
  expression: string,
  visitedConstantNames: Set<string> = new Set(),
): string | null {
  const declaringClassName = phpLaravelClassNameContainingExpression(
    source,
    expression,
  );

  if (!declaringClassName) {
    return null;
  }

  const value = stripOuterParentheses(expression.trim());
  const constantMatch =
    /^((?:self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*(?!class\b)([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
      value,
    );
  const ownerName = constantMatch?.[1]?.replace(/^\\+/, "") ?? null;
  const constantName = constantMatch?.[2] ?? null;
  const ownerClassName =
    ownerName && constantName
      ? phpClassNameForConstantExpression(source, declaringClassName, ownerName)
      : null;

  if (!ownerClassName || !constantName) {
    return null;
  }

  const visitKey = `${ownerClassName.toLowerCase()}::${constantName.toLowerCase()}`;

  if (visitedConstantNames.has(visitKey)) {
    return null;
  }

  const body = phpClassBodyForClassName(source, ownerClassName);

  if (!body) {
    return null;
  }

  visitedConstantNames.add(visitKey);

  for (const statement of phpClassConstStatements(body)) {
    for (const item of splitPhpParameterList(statement)) {
      const assignmentMatch =
        /^(?:[\s\S]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(
          item.trim(),
        );
      const name = assignmentMatch?.[1] ?? null;
      const constantValue = assignmentMatch?.[2]?.trim() ?? null;

      if (
        !name ||
        !constantValue ||
        name.toLowerCase() !== constantName.toLowerCase()
      ) {
        continue;
      }

      const constantBody = phpArrayExpressionBody(constantValue);

      if (constantBody !== null) {
        return constantBody;
      }

      const nestedConstantBody = phpLaravelMorphMapArrayConstantBody(
        source,
        constantValue,
        visitedConstantNames,
      );

      if (nestedConstantBody !== null) {
        return nestedConstantBody;
      }
    }
  }

  return null;
}

function phpLaravelMorphMapEntriesFromArrayBody(
  source: string,
  body: string,
): PhpLaravelMorphMapEntry[] {
  return splitPhpParameterList(body).flatMap((entry) => {
    const arrowIndex = topLevelArrayArrowIndex(entry);

    if (arrowIndex < 0) {
      return [];
    }

    const alias = phpStringLiteralValue(entry.slice(0, arrowIndex));
    const modelClassName = phpLaravelMorphMapModelClassNameFromExpression(
      source,
      entry.slice(arrowIndex + 2),
    );

    return alias && modelClassName ? [{ alias, modelClassName }] : [];
  });
}

function phpLaravelMorphMapModelClassNameFromExpression(
  source: string,
  expression: string,
): string | null {
  const classNamePattern =
    String.raw`^\s*` +
      PHP_CLASS_NAME_CAPTURE_PATTERN +
      String.raw`\s*::\s*class\s*$`;
  const classNameMatch = new RegExp(classNamePattern).exec(expression);
  const classConstantName = classNameMatch?.[1] ?? null;

  if (classConstantName) {
    const resolvedClassName =
      resolvePhpClassName(source, classConstantName)?.replace(/^\\+/, "") ??
      classConstantName.replace(/^\\+/, "");

    return isLaravelModelType(resolvedClassName) ? resolvedClassName : null;
  }

  const declaringClassName = phpLaravelClassNameContainingExpression(
    source,
    expression,
  );
  const classStringConstant = declaringClassName
    ? phpClassStringExpressionValue(source, expression, declaringClassName)
    : null;

  if (classStringConstant) {
    const resolvedClassName = classStringConstant.includes("\\")
      ? classStringConstant.replace(/^\\+/, "")
      : (resolvePhpClassName(source, classStringConstant)?.replace(/^\\+/, "") ??
        classStringConstant);

    return isLaravelModelType(resolvedClassName) ? resolvedClassName : null;
  }

  const stringClassName = phpStringLiteralValue(expression)?.replace(/^\\+/, "");

  if (!stringClassName) {
    return null;
  }

  const resolvedClassName = stringClassName.includes("\\")
    ? stringClassName
    : (resolvePhpClassName(source, stringClassName)?.replace(/^\\+/, "") ??
      stringClassName);

  return isLaravelModelType(resolvedClassName) ? resolvedClassName : null;
}

export function phpLaravelScopeMethodName(scopeName: string): string | null {
  const normalizedScopeName = scopeName.trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedScopeName)) {
    return null;
  }

  return `scope${normalizedScopeName[0]?.toUpperCase() ?? ""}${normalizedScopeName.slice(1)}`;
}

function phpLaravelLocalScopeNameForMethod(
  method: PhpMethodCompletion,
): string | null {
  if (method.kind === "property" || method.isStatic) {
    return null;
  }

  return method.kind === "scope"
    ? method.name
    : laravelLocalScopeName(method.name);
}

/**
 * Reports whether a member is a raw local-scope source method - either the
 * classic `scopeX` convention or a `#[Scope]`-attributed method - that the
 * derived scope completion replaces. Callers drop these from the receiver's
 * own members so the canonical derived scope is the only representation.
 */
export function isPhpLaravelLocalScopeSourceMethod(
  method: PhpMethodCompletion,
): boolean {
  return phpLaravelLocalScopeNameForMethod(method) !== null;
}

export function phpLaravelLocalScopeCompletionsFromMethods(
  methods: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return dedupePhpMembers(
    methods.flatMap((method) => {
      const scopeName = phpLaravelLocalScopeNameForMethod(method);

      if (!scopeName) {
        return [];
      }

      return [
        {
          declaringClassName: method.declaringClassName,
          kind: "scope" as const,
          name: scopeName,
          parameters: splitPhpParameterList(method.parameters).slice(1).join(", "),
          returnType:
            method.returnType === "void" || method.returnType === "never"
              ? "Illuminate\\Database\\Eloquent\\Builder"
              : method.returnType,
          ...(method.visibility ? { visibility: method.visibility } : {}),
        },
      ];
    }),
  );
}

export function phpLaravelStaticLocalScopeCompletionsFromMethods(
  methods: PhpMethodCompletion[],
): PhpMethodCompletion[] {
  return phpLaravelLocalScopeCompletionsFromMethods(methods).map((method) => ({
    ...method,
    isStatic: true,
  }));
}

export function phpLaravelDynamicWhereCompletionsFromSource(
  source: string,
  declaringClassName: string,
  options: { isStatic?: boolean } = {},
): PhpMethodCompletion[] {
  const attributes = new Set<string>();

  for (const attribute of phpLaravelFillableAttributes(source, declaringClassName)) {
    attributes.add(attribute);
  }

  for (const [attribute] of phpLaravelDefaultAttributes(
    source,
    declaringClassName,
  )) {
    attributes.add(attribute);
  }

  for (const attribute of phpLaravelDateAttributes(source, declaringClassName)) {
    attributes.add(attribute);
  }

  for (const [attribute] of phpLaravelCastAttributes(source, declaringClassName)) {
    attributes.add(attribute);
  }

  for (const [attribute] of phpLaravelSchemaAttributesForModel(
    source,
    declaringClassName,
  )) {
    attributes.add(attribute);
  }

  return dedupePhpMembers(
    Array.from(attributes).flatMap((attribute) => {
      const suffix = phpLaravelDynamicWhereSuffix(attribute);

      if (!suffix) {
        return [];
      }

      return [
        {
          declaringClassName,
          ...(options.isStatic ? { isStatic: true } : {}),
          kind: "magic-where" as const,
          name: `where${suffix}`,
          parameters: "$value",
          returnType: "Illuminate\\Database\\Eloquent\\Builder",
        },
      ];
    }),
  );
}

export function phpLaravelDynamicWhereAttributeTargetFromSource(
  source: string,
  methodName: string,
): PhpLaravelDynamicWhereAttributeTarget | null {
  const firstOccurrence =
    phpLaravelDynamicWhereAttributeOccurrencesForMethod(source, methodName)[0] ??
    phpLaravelDynamicWhereAttributeOccurrencesForMethodFromOccurrences(
      methodName,
      phpLaravelSchemaAttributeOccurrences(source),
    )[0];

  if (!firstOccurrence) {
    return null;
  }

  return {
    attributeName: firstOccurrence.attributeName,
    position: editorPositionAtOffset(source, firstOccurrence.attributeOffset),
  };
}

export function phpLaravelModelAttributeTargetFromSource(
  source: string,
  attributeName: string,
): PhpLaravelDynamicWhereAttributeTarget | null {
  const attributeLookup = attributeName.trim().toLowerCase();

  if (!attributeLookup) {
    return null;
  }

  const firstOccurrence = [
    ...phpLaravelDynamicWhereAttributeOccurrences(source),
    ...phpLaravelSchemaAttributeOccurrences(source),
    ...phpArrayStringValueOccurrences(source, "appends"),
  ].find(
    (occurrence) => occurrence.attributeName.toLowerCase() === attributeLookup,
  );

  if (!firstOccurrence) {
    return null;
  }

  return {
    attributeName: firstOccurrence.attributeName,
    position: editorPositionAtOffset(source, firstOccurrence.attributeOffset),
  };
}

export function phpLaravelModelAccessorTargetFromSource(
  source: string,
  attributeName: string,
): PhpLaravelDynamicWhereAttributeTarget | null {
  const attributeLookup = attributeName.trim().toLowerCase();

  if (!attributeLookup) {
    return null;
  }

  const firstMatch = phpLaravelAccessorAttributeMatches(source).find(
    (match) => match.attributeName.toLowerCase() === attributeLookup,
  );

  if (!firstMatch) {
    return null;
  }

  return {
    attributeName: firstMatch.attributeName,
    position: editorPositionAtOffset(source, firstMatch.methodOffset),
  };
}

export function isLaravelDynamicWhereMethodForSource(
  source: string,
  methodName: string,
): boolean {
  return phpLaravelDynamicWhereAttributeOccurrencesForMethod(source, methodName)
    .length > 0;
}

export function phpLaravelModelAttributeCompletionsFromSource(
  source: string,
  declaringClassName: string,
  workspaceSources: readonly string[] = [],
): PhpMethodCompletion[] {
  const attributes = new Map<string, string | null>();

  for (const attribute of phpLaravelFillableAttributes(source, declaringClassName)) {
    attributes.set(attribute, "mixed");
  }

  for (const [attribute, returnType] of phpLaravelSchemaAttributesForModel(
    source,
    declaringClassName,
  )) {
    attributes.set(attribute, returnType);
  }

  for (const [attribute, returnType] of phpLaravelMigrationSchemaAttributesForModel(
    source,
    declaringClassName,
    workspaceSources,
  )) {
    attributes.set(attribute, returnType);
  }

  for (const [attribute, returnType] of phpLaravelDefaultAttributes(
    source,
    declaringClassName,
  )) {
    attributes.set(attribute, returnType);
  }

  for (const attribute of phpLaravelDateAttributes(source, declaringClassName)) {
    attributes.set(attribute, "\\Illuminate\\Support\\Carbon");
  }

  for (const attribute of phpLaravelAppendedAttributes(
    source,
    declaringClassName,
  )) {
    attributes.set(attribute, "mixed");
  }

  for (const [attribute, returnType] of phpLaravelCastAttributes(
    source,
    declaringClassName,
  )) {
    attributes.set(attribute, returnType);
  }

  for (const [attribute, returnType] of phpLaravelAccessorAttributes(source)) {
    attributes.set(attribute, returnType);
  }

  return Array.from(attributes, ([name, returnType]) => ({
    declaringClassName,
    kind: "property" as const,
    name,
    parameters: "",
    returnType,
  }));
}

export function phpLaravelModelAttributeClassTypeFromSource(
  source: string,
  attributeName: string,
  declaringClassName = "",
): string | null {
  const attributeLookup = attributeName.trim().toLowerCase();

  if (!attributeLookup) {
    return null;
  }

  const attribute = phpLaravelModelAttributeCompletionsFromSource(
    source,
    declaringClassName,
  ).find((completion) => completion.name.toLowerCase() === attributeLookup);

  return attribute?.returnType
    ? phpDeclaredTypeCandidate(attribute.returnType)
    : null;
}

export function phpLaravelModelPropertyClassTypeFromSource(
  source: string,
  propertyName: string,
  receiverType: string | null,
): string | null {
  const higherOrderProxyElementType =
    phpLaravelHigherOrderCollectionProxyElementType(
      source,
      propertyName,
      receiverType,
    );

  if (higherOrderProxyElementType) {
    return higherOrderProxyElementType;
  }

  const receiverModelType = receiverType
    ? phpLaravelResolvedModelTypeCandidate(source, receiverType)
    : null;

  if (receiverType && !receiverModelType) {
    return null;
  }

  return (
    phpLaravelRelationPropertyClassTypeFromSource(
      source,
      propertyName,
      receiverType,
    ) ??
    phpLaravelModelAttributeClassTypeFromSource(
      source,
      propertyName,
      receiverModelType ?? "",
    )
  );
}

function phpLaravelRelationPropertyClassTypeFromSource(
  source: string,
  propertyName: string,
  receiverType: string | null,
): string | null {
  const modelType = phpLaravelResolvedModelTypeCandidate(source, receiverType);

  if (!modelType) {
    return null;
  }

  const classSource = phpClassSourceForClassName(source, modelType) ?? source;
  const propertyLookup = propertyName.trim().toLowerCase();
  const relationType =
    phpLaravelRelationPropertyCompletionsFromSource(
      classSource,
      modelType,
      source,
    ).find(
      (completion) =>
        completion.kind === "property" &&
        completion.name.toLowerCase() === propertyLookup,
    )?.returnType ?? null;

  return phpLaravelResolvedSingularModelTypeCandidate(source, relationType);
}

export function phpLaravelRelationPropertyCompletionsFromSource(
  source: string,
  declaringClassName: string,
  contextSource = source,
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (/\b(?:private|protected|static)\b/.test(modifiers)) {
      continue;
    }

    const name = match[2];

    if (!name) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const docBlock = phpDocBlockBefore(source, functionOffset);
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const returnType = bestPhpReturnType(declaredReturnType, documentedReturnType);
    const relationTargetType = phpLaravelRelationTargetTypeFromMethod(
      source,
      contextSource,
      declaringClassName,
      name,
      returnType,
      true,
    );

    if (!relationTargetType && !isLaravelEloquentRelationReturnType(returnType, true)) {
      continue;
    }

    members.push({
      declaringClassName,
      kind: "property",
      name,
      parameters: "",
      returnType: relationTargetType ?? "mixed",
    });
  }

  members.push(
    ...phpLaravelDynamicRelationPropertyCompletionsFromSource(
      contextSource,
      declaringClassName,
      source,
    ),
  );

  return dedupePhpMembers(members);
}

function phpLaravelRelationPropertyTargetTypeByName(
  source: string,
  contextSource: string,
  declaringClassName: string,
  propertyName: string,
  visited = new Set<string>(),
): string | null {
  const lookupName = propertyName.trim().toLowerCase();

  if (!lookupName) {
    return null;
  }

  const visitedKey = `${declaringClassName.trim().toLowerCase()}:${lookupName}`;

  if (visited.has(visitedKey)) {
    return null;
  }

  visited.add(visitedKey);

  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();
    const name = match[2];

    if (
      !name ||
      name.toLowerCase() !== lookupName ||
      /\b(?:private|protected|static)\b/.test(modifiers)
    ) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const docBlock = phpDocBlockBefore(source, functionOffset);
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const returnType = bestPhpReturnType(declaredReturnType, documentedReturnType);

    return phpLaravelRelationTargetTypeFromMethod(
      source,
      contextSource,
      declaringClassName,
      name,
      returnType,
      false,
      visited,
    );
  }

  return null;
}

function phpLaravelRelationTargetTypeFromMethod(
  source: string,
  contextSource: string,
  declaringClassName: string,
  methodName: string,
  returnType: string | null,
  allowDisplayUnion: boolean,
  visited = new Set<string>(),
): string | null {
  return (
    (allowDisplayUnion
      ? phpLaravelRelationDisplayTypeFromReturnType(
          source,
          returnType,
          declaringClassName,
        )
      : phpLaravelRelationTypeForDeclaringClass(
          phpLaravelRelationModelTypeFromReturnType(returnType),
          declaringClassName,
          source,
        )) ??
    phpMethodReturnExpressions(source, methodName)
      .map((expression) =>
        phpLaravelRelationTypeForDeclaringClass(
          phpLaravelRelationTargetClassNameFromExpression(
            expression,
            true,
            phpLocalClassStringResolverForMethodReturnExpression(
              source,
              methodName,
              expression,
            ),
            phpClassStringExpressionResolverForMethodReturnExpression(
              source,
              methodName,
              expression,
              declaringClassName,
            ),
          ) ??
            phpLaravelFluentThroughRelationTargetClassNameFromExpression(
              source,
              contextSource,
              declaringClassName,
              expression,
              visited,
            ) ??
            phpLaravelMorphToTargetClassNameFromContext(
              contextSource,
              declaringClassName,
              expression,
            ),
          declaringClassName,
          source,
        ),
      )
      .find((target): target is string => Boolean(target)) ??
    null
  );
}

function phpLaravelRelationDisplayTypeFromReturnType(
  source: string,
  returnType: string | null,
  declaringClassName: string,
): string | null {
  const singleTargetType = phpLaravelRelationTypeForDeclaringClass(
    phpLaravelRelationModelTypeFromReturnType(returnType),
    declaringClassName,
    source,
  );

  if (singleTargetType) {
    return singleTargetType;
  }

  if (!isLaravelMorphToReturnType(returnType)) {
    return null;
  }

  const targetTypes = Array.from(
    new Set(
      phpLaravelRelationModelTypesFromReturnType(returnType)
        .map((targetType) =>
          phpLaravelRelationTypeForDeclaringClass(
            targetType,
            declaringClassName,
            source,
          ),
        )
        .filter((targetType): targetType is string => Boolean(targetType)),
    ),
  );

  return targetTypes.length > 1 ? targetTypes.join("|") : null;
}

function phpLaravelFluentThroughRelationTargetClassNameFromExpression(
  source: string,
  contextSource: string,
  declaringClassName: string,
  expression: string,
  visited: Set<string>,
): string | null {
  const path = phpLaravelFluentThroughRelationPathFromExpression(expression);

  if (!path) {
    return null;
  }

  const intermediateType = phpLaravelRelationPropertyTargetTypeByName(
    source,
    contextSource,
    declaringClassName,
    path.throughRelationName,
    visited,
  );

  if (!intermediateType) {
    return null;
  }

  const intermediateSource =
    phpClassSourceForClassName(contextSource, intermediateType) ?? contextSource;

  return phpLaravelRelationPropertyTargetTypeByName(
    intermediateSource,
    contextSource,
    intermediateType,
    path.distantRelationName,
    visited,
  );
}

function phpLaravelFluentThroughRelationPathFromExpression(
  expression: string,
): { throughRelationName: string; distantRelationName: string } | null {
  const normalizedExpression = expression.trim();
  const dynamicPath =
    phpLaravelDynamicFluentThroughRelationPathFromExpression(
      normalizedExpression,
    );

  if (dynamicPath) {
    return dynamicPath;
  }

  const throughPattern = /\bthrough\s*\(/g;

  for (const match of normalizedExpression.matchAll(throughPattern)) {
    const throughOpenOffset =
      (match.index ?? 0) + (match[0]?.lastIndexOf("(") ?? 0);
    const throughCloseOffset = matchingPairOffset(
      normalizedExpression,
      throughOpenOffset,
      "(",
      ")",
    );

    if (throughCloseOffset === null) {
      continue;
    }

    const throughRelationName = phpStringLiteralValue(
      phpLaravelRelationNameArgument(
        normalizedExpression.slice(throughOpenOffset + 1, throughCloseOffset),
        ["relationship", "relation"],
      ) ?? "",
    );

    if (!isPhpAttributeName(throughRelationName)) {
      continue;
    }

    const afterThrough = normalizedExpression.slice(throughCloseOffset + 1);
    const hasMatch = /^\s*(?:->|\?->)\s*has\s*\(/.exec(afterThrough);

    if (!hasMatch) {
      continue;
    }

    const hasOpenOffset =
      throughCloseOffset + 1 + (hasMatch[0]?.lastIndexOf("(") ?? 0);
    const hasCloseOffset = matchingPairOffset(
      normalizedExpression,
      hasOpenOffset,
      "(",
      ")",
    );

    if (hasCloseOffset === null) {
      continue;
    }

    const distantRelationName = phpStringLiteralValue(
      phpLaravelRelationNameArgument(
        normalizedExpression.slice(hasOpenOffset + 1, hasCloseOffset),
        ["relation", "relationship"],
      ) ?? "",
    );

    if (isPhpAttributeName(distantRelationName)) {
      return { distantRelationName, throughRelationName };
    }
  }

  return null;
}

function phpLaravelRelationNameArgument(
  argumentsSource: string,
  namedArguments: string[],
): string | null {
  for (const name of namedArguments) {
    const value = phpNamedArgumentExpression(argumentsSource, name);

    if (value) {
      return value;
    }
  }

  return phpFirstPositionalArgument(argumentsSource);
}

function phpLaravelDynamicFluentThroughRelationPathFromExpression(
  expression: string,
): { throughRelationName: string; distantRelationName: string } | null {
  const pattern =
    /\bthrough([A-Z][A-Za-z0-9_]*)\s*\(\s*\)\s*(?:->|\?->)\s*has([A-Z][A-Za-z0-9_]*)\s*\(/g;

  for (const match of expression.matchAll(pattern)) {
    const throughRelationName = phpLaravelStudlyRelationName(match[1] ?? "");
    const distantRelationName = phpLaravelStudlyRelationName(match[2] ?? "");

    if (throughRelationName && distantRelationName) {
      return { distantRelationName, throughRelationName };
    }
  }

  return null;
}

function phpLaravelStudlyRelationName(value: string): string | null {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(value)) {
    return null;
  }

  const relationName = `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

  return isPhpAttributeName(relationName) ? relationName : null;
}

function phpLaravelDynamicRelationPropertyCompletionsFromSource(
  source: string,
  declaringClassName: string,
  declaringClassSource: string,
): PhpMethodCompletion[] {
  const members: PhpMethodCompletion[] = [];
  const masked = maskPhpStringsAndComments(source);
  const ownerPattern =
    String.raw`(?:__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;
  const pattern = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_\\])(` +
      ownerPattern +
      String.raw`)\s*::\s*resolveRelationUsing\s*\(`,
    "g",
  );

  for (const match of masked.matchAll(pattern)) {
    const ownerName = match[1]?.replace(/^\\+/, "") ?? "";

    if (
      !phpLaravelRelationOwnerMatchesDeclaringClass(
        source,
        declaringClassSource,
        ownerName,
        declaringClassName,
      )
    ) {
      continue;
    }

    const openOffset = (match.index ?? 0) + (match[0]?.lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (closeOffset === null) {
      continue;
    }

    const argumentsSource = source.slice(openOffset + 1, closeOffset);
    const relationName = phpLaravelDynamicRelationNameFromArguments(argumentsSource);
    const callbackExpression =
      phpLaravelDynamicRelationCallbackFromArguments(argumentsSource);

    if (
      !isPhpAttributeName(relationName) ||
      !callbackExpression ||
      (!phpLaravelHasRelationFactoryCallInExpression(callbackExpression, true) &&
        !phpLaravelFluentThroughRelationPathFromExpression(callbackExpression))
    ) {
      continue;
    }

    const targetClassName =
      phpLaravelRelationTargetClassNameFromExpression(
        callbackExpression,
        true,
        undefined,
        (expression) =>
          phpClassStringExpressionValue(
            source,
            expression,
            declaringClassName,
          ),
      ) ??
      phpLaravelFluentThroughRelationTargetClassNameFromExpression(
        declaringClassSource,
        source,
        declaringClassName,
        callbackExpression,
        new Set<string>(),
      ) ??
      phpLaravelMorphToTargetClassNameFromContext(
        source,
        declaringClassName,
        callbackExpression,
      );
    const relationTargetType = phpLaravelRelationTypeForDeclaringClass(
      targetClassName,
      declaringClassName,
      declaringClassSource,
    ) ?? (phpLaravelRelationClassNameFromExpression(callbackExpression) === "MorphTo"
      ? phpLaravelMorphMapModelDisplayTypeFromSource(source)
      : null);

    members.push({
      declaringClassName,
      kind: "property",
      name: relationName,
      parameters: "",
      returnType: relationTargetType ?? "mixed",
    });
  }

  return dedupePhpMembers(members);
}

function phpLaravelRelationOwnerMatchesDeclaringClass(
  source: string,
  declaringClassSource: string,
  ownerName: string,
  declaringClassName: string,
): boolean {
  const ownerType =
    phpLaravelRelationTypeForDeclaringClass(
      ownerName,
      declaringClassName,
      declaringClassSource,
    ) ?? ownerName;
  const resolvedOwnerType =
    phpLaravelResolvedClassName(source, ownerType) ?? ownerType;
  const resolvedDeclaringType =
    phpLaravelResolvedClassName(source, declaringClassName) ?? declaringClassName;
  const normalizedOwner = normalizedLaravelClassName(resolvedOwnerType);
  const normalizedDeclaring = normalizedLaravelClassName(resolvedDeclaringType);

  if (!normalizedOwner || !normalizedDeclaring) {
    return false;
  }

  if (normalizedOwner === normalizedDeclaring) {
    return true;
  }

  if (!normalizedOwner.includes("\\") || !normalizedDeclaring.includes("\\")) {
    return (
      (normalizedOwner.split("\\").pop() ?? normalizedOwner) ===
      (normalizedDeclaring.split("\\").pop() ?? normalizedDeclaring)
    );
  }

  return false;
}

function phpLaravelDynamicRelationNameFromArguments(
  argumentsSource: string,
): string | null {
  for (const [index, argument] of splitPhpParameterList(
    argumentsSource,
  ).entries()) {
    const namedArgumentMatch =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(argument);
    const argumentName = namedArgumentMatch?.[1]?.toLowerCase() ?? null;
    const value = (namedArgumentMatch?.[2] ?? argument).trim();

    if (argumentName && argumentName !== "name" && argumentName !== "relation") {
      continue;
    }

    if (!argumentName && index > 0) {
      continue;
    }

    const relationName = phpStringLiteralValue(value);

    if (relationName) {
      return relationName;
    }
  }

  return null;
}

function phpLaravelDynamicRelationCallbackFromArguments(
  argumentsSource: string,
): string | null {
  for (const [index, argument] of splitPhpParameterList(
    argumentsSource,
  ).entries()) {
    const namedArgumentMatch =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(argument);
    const argumentName = namedArgumentMatch?.[1]?.toLowerCase() ?? null;

    if (argumentName && argumentName !== "callback") {
      continue;
    }

    if (!argumentName && index !== 1) {
      continue;
    }

    return (namedArgumentMatch?.[2] ?? argument).trim() || null;
  }

  return null;
}

function laravelLocalScopeName(methodName: string): string | null {
  const match = /^scope([A-Z][A-Za-z0-9_]*)$/.exec(methodName);
  const scopeName = match?.[1];

  if (!scopeName) {
    return null;
  }

  return `${scopeName[0]?.toLowerCase() ?? ""}${scopeName.slice(1)}`;
}

function phpLaravelRepositoryDeclaredMethodReturnTypes(
  source: string,
  methodName: string,
  receiverClassName: string | null,
): string[] {
  return phpLaravelRepositoryTypeBodyRanges(source, receiverClassName).flatMap(
    (range) => {
      const body = maskPhpStringsAndComments(
        source.slice(range.bodyStart, range.bodyEnd),
      );
      const pattern = new RegExp(
        `(?:^|\\n)\\s*((?:(?:abstract|final|private|protected|public|static)\\s+)*)function\\s+&?\\s*${escapeRegExp(
          methodName,
        )}\\s*\\(([^)]*)\\)\\s*(?::\\s*([^;{\\n]+))?`,
        "g",
      );
      const returnTypes: string[] = [];

      for (const match of body.matchAll(pattern)) {
        const modifiers = (match[1] ?? "").toLowerCase();

        if (/\b(?:private|protected|static)\b/.test(modifiers)) {
          continue;
        }

        const functionOffset =
          range.bodyStart + (match.index ?? 0) + match[0].lastIndexOf("function");
        const docBlock = phpDocBlockBefore(source, functionOffset);
        const declaredReturnType = normalizeReturnType(match[3] ?? null);
        const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
        const returnType = bestPhpReturnType(
          declaredReturnType,
          documentedReturnType,
        );

        if (returnType) {
          returnTypes.push(returnType);
        }
      }

      return returnTypes;
    },
  );
}

function phpLaravelRepositoryPhpDocMethodReturnTypes(
  source: string,
  methodName: string,
  receiverClassName: string | null,
): string[] {
  return phpLaravelRepositoryTypeDocBlocks(source, receiverClassName).flatMap(
    (docBlock) => {
      const returnTypes: string[] = [];
      const pattern = new RegExp(
        `@(?:(?:phpstan|psalm)-)?method\\s+(?:static\\s+)?([^\\s(]+)\\s+${escapeRegExp(
          methodName,
        )}\\s*\\(`,
        "g",
      );

      for (const match of docBlock.matchAll(pattern)) {
        const returnType = normalizeReturnType(match[1] ?? null);

        if (returnType) {
          returnTypes.push(returnType);
        }
      }

      return returnTypes;
    },
  );
}

function phpLaravelRepositoryMethodBuilderReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  if (!isLaravelRepositoryType(receiverType)) {
    return null;
  }

  const receiverClassName = phpLaravelResolvedClassName(source, receiverType ?? "");
  const returnTypes = [
    ...phpLaravelRepositoryDeclaredMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
    ...phpLaravelRepositoryPhpDocMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
  ];
  const genericModelType = returnTypes
    .map((returnType) =>
      phpLaravelResolvedModelTypeCandidate(
        source,
        phpLaravelEloquentBuilderModelTypeCandidate(source, returnType),
      ),
    )
    .find((modelType): modelType is string => Boolean(modelType));

  if (genericModelType) {
    return phpLaravelEloquentBuilderType(genericModelType);
  }

  const expressionModelType = phpLaravelRepositoryMethodReturnExpressions(
    source,
    methodName,
    receiverClassName,
  )
    .map((expression) =>
      phpLaravelEloquentBuilderModelTypeFromExpression(source, expression),
    )
    .find((modelType): modelType is string => Boolean(modelType));

  if (expressionModelType) {
    return phpLaravelEloquentBuilderType(expressionModelType);
  }

  const conventionModelType = returnTypes.some((returnType) =>
    phpLaravelGenericCarrierMatches(source, returnType, [
      "builder",
      "illuminate\\database\\eloquent\\builder",
    ]),
  )
    ? (phpLaravelRepositoryGenericInheritanceModelTypeFromReceiver(
        source,
        receiverType,
      ) ??
        phpLaravelRepositoryConventionModelTypeFromReceiver(source, receiverType))
    : null;

  return conventionModelType
    ? phpLaravelEloquentBuilderType(conventionModelType)
    : null;
}

function phpLaravelRepositoryMethodCollectionReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  if (!isLaravelRepositoryType(receiverType)) {
    return null;
  }

  const receiverClassName = phpLaravelResolvedClassName(source, receiverType ?? "");
  const returnTypes = [
    ...phpLaravelRepositoryDeclaredMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
    ...phpLaravelRepositoryPhpDocMethodReturnTypes(
      source,
      methodName,
      receiverClassName,
    ),
  ];
  const genericModelType = returnTypes
    .map((returnType) =>
      phpLaravelResolvedModelTypeCandidate(
        source,
        phpLaravelCollectionModelTypeCandidate(source, returnType),
      ),
    )
    .find((modelType): modelType is string => Boolean(modelType));

  if (genericModelType) {
    return phpLaravelEloquentBuilderCollectionType(genericModelType, "get");
  }

  const expressionCollectionType = phpLaravelRepositoryMethodReturnExpressions(
    source,
    methodName,
    receiverClassName,
  )
    .map((expression) =>
      phpLaravelEloquentBuilderCollectionTypeFromExpression(source, expression),
    )
    .find(
      (
        collectionType,
      ): collectionType is PhpLaravelBuilderCollectionExpressionType =>
        Boolean(collectionType),
    );

  if (expressionCollectionType) {
    return phpLaravelEloquentBuilderCollectionType(
      expressionCollectionType.modelType,
      expressionCollectionType.collectionMethodName,
    );
  }

  const conventionModelType = returnTypes.some((returnType) =>
    phpLaravelGenericCarrierMatches(source, returnType, [
      "collection",
      "illuminate\\database\\eloquent\\collection",
      "illuminate\\support\\collection",
      "illuminate\\support\\lazycollection",
    ]),
  )
    ? (phpLaravelRepositoryGenericInheritanceModelTypeFromReceiver(
        source,
        receiverType,
      ) ??
        phpLaravelRepositoryConventionModelTypeFromReceiver(source, receiverType))
    : null;

  return conventionModelType
    ? phpLaravelEloquentBuilderCollectionType(conventionModelType, "get")
    : null;
}

function phpLaravelRepositoryMethodReturnExpressions(
  source: string,
  methodName: string,
  receiverClassName: string | null,
): string[] {
  return phpLaravelRepositoryTypeBodyRanges(source, receiverClassName).flatMap(
    (range) =>
      phpMethodReturnExpressions(
        source.slice(range.bodyStart, range.bodyEnd),
        methodName,
      ),
  );
}

function phpLaravelRepositoryGenericInheritanceModelTypeFromReceiver(
  source: string,
  receiverType: string | null,
): string | null {
  const receiverClassName =
    phpLaravelResolvedClassName(source, receiverType ?? "") ??
    receiverType?.trim().replace(/^\\+/, "") ??
    null;

  if (!isLaravelRepositoryType(receiverClassName)) {
    return null;
  }

  return phpLaravelRepositoryTypeDocBlocks(source, receiverClassName)
    .flatMap((docBlock) => phpLaravelGenericInheritanceModelTypes(docBlock))
    .map((typeName) => phpLaravelResolvedModelTypeCandidate(source, typeName))
    .find((modelType): modelType is string => Boolean(modelType)) ?? null;
}

function phpLaravelGenericInheritanceModelTypes(docBlock: string): string[] {
  const modelTypes: string[] = [];

  for (const match of docBlock.matchAll(
    /@(?:(?:phpstan|psalm|template)-)?(?:extends|implements|use)\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? "");

    if (!typeName) {
      continue;
    }

    modelTypes.push(...phpDeclaredGenericTypeCandidates(typeName));
  }

  return modelTypes;
}

function phpLaravelEloquentMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  callExpression: string | null,
  workspaceSources: readonly string[],
): string | null {
  const relationFactoryReturnType =
    phpLaravelRelationFactoryCallReturnTypeFromSource(
      source,
      methodName,
      receiverType,
      receiverExpression,
      callExpression,
    );

  if (relationFactoryReturnType) {
    return relationFactoryReturnType;
  }

  const fluentThroughReturnType =
    phpLaravelFluentThroughMethodCallReturnTypeFromSource(
      source,
      methodName,
      receiverType,
      receiverExpression,
      callExpression,
      workspaceSources,
    );

  if (fluentThroughReturnType) {
    return fluentThroughReturnType;
  }

  const relationMethodReturnType =
    phpLaravelRelationMethodCallReturnTypeFromSource(
      source,
      methodName,
      receiverType,
    );

  if (relationMethodReturnType) {
    return relationMethodReturnType;
  }

  const relationModelType = phpLaravelEloquentRelationModelTypeFromReceiverType(
    source,
    receiverType,
  );

  if (relationModelType) {
    if (isLaravelEloquentRelationFluentMethod(methodName)) {
      return receiverType;
    }

    return phpLaravelEloquentBuilderCallReturnType(
      source,
      relationModelType,
      methodName,
      callExpression,
      workspaceSources,
    );
  }

  const builderModelType =
    phpLaravelEloquentBuilderModelTypeFromReceiverType(source, receiverType) ??
    phpLaravelEloquentBuilderModelTypeFromExpression(
      source,
      receiverExpression ?? "",
    );

  if (builderModelType) {
    return phpLaravelEloquentBuilderCallReturnType(
      source,
      builderModelType,
      methodName,
      callExpression,
      workspaceSources,
    );
  }

  const receiverModelType = phpLaravelResolvedModelTypeCandidate(
    source,
    receiverType,
  );

  if (
    receiverModelType &&
    phpLaravelModelHasLocalScope(source, receiverModelType, methodName)
  ) {
    return phpLaravelEloquentBuilderType(receiverModelType);
  }

  const modelType = phpLaravelStaticModelReceiverType(source, receiverType);

  return modelType
    ? phpLaravelStaticModelCallReturnType(
        source,
        modelType,
        methodName,
        callExpression,
        workspaceSources,
      )
    : null;
}

function phpLaravelCollectionMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  const modelType = phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelCollectionModelTypeCandidate(source, receiverType),
  );

  if (!modelType) {
    return null;
  }

  if (isLaravelCollectionTerminalModelMethod(methodName)) {
    return modelType;
  }

  if (methodName.toLowerCase() === "toquery") {
    return phpLaravelEloquentBuilderType(modelType);
  }

  if (isLaravelCollectionFluentMethod(methodName)) {
    return receiverType;
  }

  return null;
}

function phpLaravelEloquentBuilderModelTypeFromReceiverType(
  source: string,
  receiverType: string | null,
): string | null {
  return phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelEloquentBuilderModelTypeCandidate(source, receiverType),
  );
}

function phpLaravelEloquentRelationModelTypeFromReceiverType(
  source: string,
  receiverType: string | null,
): string | null {
  return phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelRelationModelTypeFromReturnType(receiverType),
  );
}

function phpLaravelStaticModelReceiverType(
  source: string,
  receiverType: string | null,
): string | null {
  return phpLaravelResolvedModelTypeCandidate(source, receiverType);
}

export function phpLaravelResolvedModelTypeCandidate(
  source: string,
  typeName: string | null,
): string | null {
  const resolvedClassName = phpLaravelResolvedClassName(source, typeName ?? "");

  return resolvedClassName && isLaravelModelType(resolvedClassName)
    ? resolvedClassName
    : null;
}

function phpLaravelResolvedSingularModelTypeCandidate(
  source: string,
  typeName: string | null,
): string | null {
  if (phpTypeHasTopLevelUnion(typeName ?? "")) {
    return null;
  }

  return phpLaravelResolvedModelTypeCandidate(source, typeName);
}

function phpTypeHasTopLevelUnion(typeName: string): boolean {
  let depth = 0;

  for (let index = 0; index < typeName.length; index += 1) {
    const character = typeName[index] ?? "";

    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "|" && depth === 0) {
      return true;
    }
  }

  return false;
}

function phpLaravelStaticModelCallReturnType(
  source: string,
  modelType: string,
  methodName: string,
  callExpression: string | null,
  workspaceSources: readonly string[] = [],
): string | null {
  if (isLaravelEloquentModelFluentMethod(methodName)) {
    return modelType;
  }

  return phpLaravelEloquentBuilderCallReturnType(
    source,
    modelType,
    methodName,
    callExpression,
    workspaceSources,
  );
}

function phpLaravelRelationFactoryCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  callExpression: string | null,
): string | null {
  const relationClassName = phpLaravelRelationFactoryClassName(methodName);

  if (!relationClassName) {
    return null;
  }

  const declaringModelType = phpLaravelStaticModelReceiverType(source, receiverType);

  if (!declaringModelType) {
    return null;
  }

  const expression = callExpression ?? receiverExpression ?? "";
  const targetClassName =
    phpLaravelRelationTargetClassNameFromExpression(
      expression,
      true,
      phpLocalClassStringResolverBeforeExpression(source, expression),
      phpClassStringExpressionResolverBeforeExpression(
        source,
        expression,
        declaringModelType,
      ),
    ) ??
    (relationClassName === "MorphTo"
      ? phpLaravelMorphToTargetClassNameFromContext(
          source,
          declaringModelType,
          expression,
        )
      : null);
  const relatedModelType = phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelRelationTypeForDeclaringClass(
      targetClassName,
      declaringModelType,
      source,
    ),
  );

  return relatedModelType
    ? `Illuminate\\Database\\Eloquent\\Relations\\${relationClassName}<${relatedModelType}>`
    : null;
}

function phpLaravelRelationMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  const declaringModelType = phpLaravelStaticModelReceiverType(
    source,
    receiverType,
  );

  if (!declaringModelType) {
    return null;
  }

  const declaringSource =
    phpClassSourceForClassName(source, declaringModelType) ?? source;
  const relationTargetType = phpLaravelRelationPropertyTargetTypeByName(
    declaringSource,
    source,
    declaringModelType,
    methodName,
  );
  const relationClassName = phpLaravelRelationClassNameForMethod(
    declaringSource,
    methodName,
  );

  if (!relationTargetType || !relationClassName) {
    return null;
  }

  const relatedModelType = phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelRelationTypeForDeclaringClass(
      relationTargetType,
      declaringModelType,
      declaringSource,
    ),
  );

  return relatedModelType
    ? `Illuminate\\Database\\Eloquent\\Relations\\${relationClassName}<${relatedModelType}>`
    : null;
}

function phpLaravelRelationClassNameForMethod(
  source: string,
  methodName: string,
): string | null {
  const lookupName = methodName.trim().toLowerCase();

  if (!lookupName) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();
    const name = match[2];

    if (
      !name ||
      name.toLowerCase() !== lookupName ||
      /\b(?:private|protected|static)\b/.test(modifiers)
    ) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const docBlock = phpDocBlockBefore(source, functionOffset);
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const returnType = bestPhpReturnType(declaredReturnType, documentedReturnType);
    const relationClassName = phpLaravelRelationClassNameFromReturnType(returnType);

    if (relationClassName) {
      return relationClassName;
    }

    return phpMethodReturnExpressions(source, methodName)
      .map((expression) => phpLaravelRelationClassNameFromExpression(expression))
      .find((className): className is string => Boolean(className)) ?? null;
  }

  return null;
}

function phpLaravelRelationClassNameFromReturnType(
  returnType: string | null,
): string | null {
  const relationTypeName = phpLaravelEloquentRelationTypeName(returnType);

  if (!relationTypeName || !laravelEloquentRelationTypes.has(relationTypeName)) {
    return null;
  }

  return laravelEloquentRelationFactoryClassNames.get(relationTypeName) ?? null;
}

function phpLaravelRelationClassNameFromExpression(
  expression: string,
): string | null {
  const normalizedExpression = expression.trim();
  const pattern =
    /\b(belongsTo|belongsToMany|hasMany|hasManyThrough|hasOne|hasOneThrough|morphMany|morphOne|morphedByMany|morphTo|morphToMany)\s*\(/g;

  for (const match of normalizedExpression.matchAll(pattern)) {
    const relationType = match[1]?.toLowerCase();
    const relationClassName = relationType
      ? laravelEloquentRelationFactoryClassNames.get(relationType)
      : null;

    if (relationClassName) {
      return relationClassName;
    }
  }

  return phpLaravelFluentThroughRelationPathFromExpression(normalizedExpression)
    ? "HasManyThrough"
    : null;
}

function phpLaravelFluentThroughMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  callExpression: string | null,
  workspaceSources: readonly string[] = [],
): string | null {
  const expression = callExpression ?? receiverExpression ?? "";

  if (!phpLaravelFluentThroughRelationPathFromExpression(expression)) {
    return null;
  }

  const declaringModelType =
    phpLaravelStaticModelReceiverType(source, receiverType) ??
    phpLaravelThisExpressionDeclaringModelType(source, expression);

  if (!declaringModelType) {
    return null;
  }

  const declaringSource =
    phpClassSourceForClassName(source, declaringModelType) ?? source;
  const targetClassName =
    phpLaravelFluentThroughRelationTargetClassNameFromExpression(
      declaringSource,
      source,
      declaringModelType,
      expression,
      new Set<string>(),
    );
  const relatedModelType = phpLaravelResolvedModelTypeCandidate(
    source,
    phpLaravelRelationTypeForDeclaringClass(
      targetClassName,
      declaringModelType,
      declaringSource,
    ),
  );

  if (!relatedModelType) {
    return null;
  }

  if (
    phpLaravelEloquentFindCallUsesArrayIdLiteral(methodName, callExpression)
  ) {
    return phpLaravelEloquentBuilderCollectionType(relatedModelType, methodName);
  }

  if (
    isLaravelEloquentBuilderTerminalModelMethod(methodName) ||
    isLaravelCollectionTerminalModelMethod(methodName)
  ) {
    return relatedModelType;
  }

  if (isLaravelEloquentBuilderCollectionMethod(methodName)) {
    return phpLaravelEloquentBuilderCollectionType(relatedModelType, methodName);
  }

  if (
    methodName.toLowerCase() !== "has" &&
    phpLaravelEloquentBuilderCallPreservesBuilder(
      source,
      relatedModelType,
      methodName,
      workspaceSources,
    )
  ) {
    return phpLaravelEloquentBuilderType(relatedModelType);
  }

  return null;
}

function phpLaravelThisExpressionDeclaringModelType(
  source: string,
  expression: string,
): string | null {
  if (!/^\s*\$this\b/.test(expression)) {
    return null;
  }

  const className = phpLaravelClassNameContainingExpression(source, expression);

  return className && isLaravelModelType(className) ? className : null;
}

function phpLaravelClassNameContainingExpression(
  source: string,
  expression: string,
): string | null {
  const needle = expression.trim();
  const expressionOffset = needle ? source.indexOf(needle) : -1;

  if (expressionOffset < 0) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /\b(?:abstract\s+|final\s+)?(?:class|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;
  let containingClassName: string | null = null;

  for (const match of masked.matchAll(pattern)) {
    const shortName = match[1];
    const bodyStart = (match.index ?? 0) + match[0].lastIndexOf("{");
    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (
      !shortName ||
      bodyEnd === null ||
      expressionOffset < (match.index ?? 0) ||
      expressionOffset > bodyEnd
    ) {
      continue;
    }

    containingClassName = shortName;
  }

  return containingClassName
    ? (resolvePhpClassName(source, containingClassName) ?? containingClassName)
    : null;
}

function phpLaravelRelationFactoryClassName(methodName: string): string | null {
  return (
    laravelEloquentRelationFactoryClassNames.get(methodName.toLowerCase()) ?? null
  );
}

function phpLaravelMorphToTargetClassNameFromContext(
  source: string,
  declaringModelType: string,
  expression: string,
): string | null {
  const normalizedExpression = normalizePhpExpressionForComparison(expression);

  if (!/\$(?:this|[A-Za-z_][A-Za-z0-9_]*)\??->morphTo\s*\(/i.test(expression)) {
    return null;
  }

  const targets = new Set<string>();
  let hasAmbiguousDocumentedTarget = false;

  for (const method of phpLaravelClassMethodReturnContexts(
    source,
    declaringModelType,
  )) {
    if (
      !isLaravelMorphToReturnType(method.returnType) ||
      !normalizePhpExpressionForComparison(method.body).includes(
        normalizedExpression,
      )
    ) {
      continue;
    }

    const documentedTargets = phpLaravelRelationModelTypesFromReturnType(
      method.returnType,
    );

    if (documentedTargets.length > 1) {
      hasAmbiguousDocumentedTarget = true;
      continue;
    }

    const [target] = documentedTargets;

    if (target) {
      targets.add(target);
    }
  }

  if (hasAmbiguousDocumentedTarget) {
    return null;
  }

  if (targets.size === 1) {
    return Array.from(targets)[0] ?? null;
  }

  if (targets.size > 1) {
    return null;
  }

  return phpLaravelMorphMapModelTypeFromSource(source);
}

function isLaravelMorphToReturnType(returnType: string | null): boolean {
  const typeName = phpDeclaredTypeCandidate(returnType ?? "");
  const normalizedTypeName = (typeName ?? returnType ?? "")
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();
  const shortTypeName = normalizedTypeName?.startsWith(
    "illuminate\\database\\eloquent\\relations\\",
  )
    ? normalizedTypeName.split("\\").pop() ?? normalizedTypeName
    : normalizedTypeName;

  return shortTypeName === "morphto";
}

function phpLaravelClassMethodReturnContexts(
  source: string,
  className: string,
): Array<{ body: string; returnType: string | null }> {
  const contexts: Array<{ body: string; returnType: string | null }> = [];
  const ranges = phpLaravelClassBodyRanges(source, className);
  const methodPattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;

  for (const range of ranges) {
    const bodySource = source.slice(range.bodyStart, range.bodyEnd);

    for (const match of bodySource.matchAll(methodPattern)) {
      const functionOffset =
        range.bodyStart + (match.index ?? 0) + match[0].lastIndexOf("function");
      const parametersStart =
        range.bodyStart + (match.index ?? 0) + match[0].length - 1;
      const parametersEnd = matchingPairOffset(
        source,
        parametersStart,
        "(",
        ")",
      );

      if (parametersEnd === null) {
        continue;
      }

      const bodyStart = source.indexOf("{", parametersEnd);

      if (bodyStart < 0 || bodyStart > range.bodyEnd) {
        continue;
      }

      const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

      if (bodyEnd === null || bodyEnd > range.bodyEnd) {
        continue;
      }

      const declaredReturnType = normalizeReturnType(
        returnTypeAfterFunctionParameters(source, parametersEnd),
      );
      const documentedReturnType = phpDocReturnTypeFromBlock(
        phpDocBlockBefore(source, functionOffset),
      );

      contexts.push({
        body: source.slice(bodyStart + 1, bodyEnd),
        returnType: bestPhpReturnType(declaredReturnType, documentedReturnType),
      });
    }
  }

  return contexts;
}

function returnTypeAfterFunctionParameters(
  source: string,
  parametersEnd: number,
): string | null {
  const match = /^\s*:\s*([^{;\n]+)/.exec(source.slice(parametersEnd + 1));

  return match?.[1] ?? null;
}

function phpLaravelEloquentBuilderCallReturnType(
  source: string,
  modelType: string,
  methodName: string,
  callExpression: string | null,
  workspaceSources: readonly string[] = [],
): string | null {
  if (phpLaravelEloquentFindCallUsesArrayIdLiteral(methodName, callExpression)) {
    return phpLaravelEloquentBuilderCollectionType(modelType, methodName);
  }

  if (isLaravelEloquentBuilderTerminalModelMethod(methodName)) {
    return modelType;
  }

  if (isLaravelEloquentBuilderCollectionMethod(methodName)) {
    return phpLaravelEloquentBuilderCollectionType(modelType, methodName);
  }

  if (
    phpLaravelEloquentBuilderCallPreservesBuilder(
      source,
      modelType,
      methodName,
      workspaceSources,
    )
  ) {
    return phpLaravelEloquentBuilderType(modelType);
  }

  return null;
}

function phpLaravelEloquentFindCallUsesArrayIdLiteral(
  methodName: string,
  callExpression: string | null,
): boolean {
  const normalizedMethodName = methodName.toLowerCase();

  if (normalizedMethodName !== "find" && normalizedMethodName !== "findorfail") {
    return false;
  }

  const argumentsSource = phpLaravelMethodCallArgumentsSource(
    callExpression ?? "",
    methodName,
  );

  if (argumentsSource === null) {
    return false;
  }

  const idArgument =
    phpNamedArgumentExpression(argumentsSource, "id") ??
    phpFirstPositionalArgument(argumentsSource);

  return phpLaravelExpressionIsArrayLiteral(idArgument);
}

function phpLaravelMethodCallArgumentsSource(
  callExpression: string,
  methodName: string,
): string | null {
  const maskedExpression = maskPhpStringsAndComments(callExpression);
  const pattern = new RegExp(
    `(?:->|::)\\s*${escapeRegExp(methodName)}\\s*\\(`,
    "gi",
  );
  let argumentsSource: string | null = null;

  for (const match of maskedExpression.matchAll(pattern)) {
    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingPairOffset(
      callExpression,
      openOffset,
      "(",
      ")",
    );

    if (closeOffset === null) {
      continue;
    }

    argumentsSource = callExpression.slice(openOffset + 1, closeOffset);
  }

  return argumentsSource;
}

function phpLaravelExpressionIsArrayLiteral(expression: string | null): boolean {
  const trimmed = expression?.trim() ?? "";

  if (trimmed.startsWith("[")) {
    return matchingPairOffset(trimmed, 0, "[", "]") === trimmed.length - 1;
  }

  const arrayMatch = /^array\s*\(/i.exec(trimmed);

  if (!arrayMatch) {
    return false;
  }

  const openOffset = arrayMatch[0].lastIndexOf("(");

  return matchingPairOffset(trimmed, openOffset, "(", ")") === trimmed.length - 1;
}

function phpLaravelEloquentBuilderCallPreservesBuilder(
  source: string,
  modelType: string,
  methodName: string,
  workspaceSources: readonly string[] = [],
): boolean {
  return (
    isLaravelEloquentBuilderPreservingMethod(methodName) ||
    phpLaravelEloquentBuilderMacroPreservesBuilder(
      source,
      methodName,
      workspaceSources,
    ) ||
    phpLaravelModelHasDynamicWhere(source, modelType, methodName) ||
    phpLaravelModelHasLocalScope(source, modelType, methodName)
  );
}

function phpLaravelEloquentBuilderMacroPreservesBuilder(
  source: string,
  methodName: string,
  workspaceSources: readonly string[] = [],
): boolean {
  const returnType =
    phpLaravelEloquentBuilderMacroFromSource(
      source,
      methodName,
      workspaceSources,
    )?.returnType ?? null;

  return phpLaravelGenericCarrierMatches(source, returnType, [
    "builder",
    "illuminate\\database\\eloquent\\builder",
  ]);
}

function phpLaravelEloquentBuilderType(modelType: string): string {
  return `Illuminate\\Database\\Eloquent\\Builder<${modelType}>`;
}

function phpLaravelEloquentBuilderCollectionType(
  modelType: string,
  methodName: string,
): string {
  return laravelEloquentBuilderLazyCollectionMethods.has(methodName.toLowerCase())
    ? `Illuminate\\Support\\LazyCollection<int, ${modelType}>`
    : `Illuminate\\Database\\Eloquent\\Collection<int, ${modelType}>`;
}

interface PhpLaravelStaticCallChain {
  className: string;
  methodNames: string[];
}

interface PhpLaravelBuilderCollectionExpressionType {
  collectionMethodName: string;
  modelType: string;
}

export function phpLaravelEloquentBuilderModelTypeFromExpression(
  source: string,
  expression: string,
): string | null {
  return (
    phpLaravelEloquentBuilderModelTypeFromVariableExpression(
      source,
      expression,
    ) ??
    phpLaravelEloquentBuilderModelTypeFromStaticExpression(source, expression)
  );
}

function phpLaravelEloquentBuilderModelTypeFromVariableExpression(
  source: string,
  expression: string,
): string | null {
  const variableName = /^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    expression,
  )?.[1];

  if (!variableName) {
    return null;
  }

  const modelTypes = new Set<string>();

  for (const assignmentExpression of phpLaravelVariableAssignmentExpressions(
    source,
    variableName,
  )) {
    const modelType = phpLaravelEloquentBuilderModelTypeFromStaticExpression(
      source,
      assignmentExpression,
    );

    if (modelType) {
      modelTypes.add(modelType);
    }
  }

  return modelTypes.size === 1 ? Array.from(modelTypes)[0] ?? null : null;
}

function phpLaravelEloquentBuilderModelTypeFromStaticExpression(
  source: string,
  expression: string,
): string | null {
  const chain = phpLaravelStaticCallChain(expression);
  const modelType = phpLaravelResolvedModelTypeCandidate(
    source,
    chain?.className ?? null,
  );

  if (!chain || !modelType) {
    return null;
  }

  for (const methodName of chain.methodNames) {
    if (
      !phpLaravelEloquentBuilderExpressionCallPreservesBuilder(
        source,
        modelType,
        methodName,
        [],
      )
    ) {
      return null;
    }
  }

  return modelType;
}

function phpLaravelVariableAssignmentExpressions(
  source: string,
  variableName: string,
): string[] {
  const expressions: string[] = [];
  const masked = maskPhpStringsAndComments(source);
  const escapedVariableName = escapeRegExp(variableName);
  const pattern = new RegExp(
    `(?:^|[;\\n])\\s*\\$${escapedVariableName}\\s*=\\s*`,
    "g",
  );

  for (const match of masked.matchAll(pattern)) {
    const expressionStart = (match.index ?? 0) + match[0].length;
    const semicolonOffset = masked.indexOf(";", expressionStart);

    if (semicolonOffset < 0) {
      continue;
    }

    expressions.push(source.slice(expressionStart, semicolonOffset).trim());
  }

  return expressions;
}

export function phpLaravelEloquentBuilderCollectionModelTypeFromExpression(
  source: string,
  expression: string,
): string | null {
  return (
    phpLaravelEloquentBuilderCollectionTypeFromExpression(source, expression)
      ?.modelType ?? null
  );
}

function phpLaravelEloquentBuilderCollectionTypeFromExpression(
  source: string,
  expression: string,
): PhpLaravelBuilderCollectionExpressionType | null {
  const chain = phpLaravelStaticCallChain(expression);
  const modelType = phpLaravelResolvedModelTypeCandidate(
    source,
    chain?.className ?? null,
  );

  if (!chain || !modelType) {
    return null;
  }

  let collectionMethodName: string | null = null;

  for (const methodName of chain.methodNames) {
    if (collectionMethodName) {
      if (isLaravelCollectionFluentMethod(methodName)) {
        continue;
      }

      return null;
    }

    if (isLaravelEloquentBuilderCollectionMethod(methodName)) {
      collectionMethodName = methodName;
      continue;
    }

    if (
      phpLaravelEloquentBuilderExpressionCallPreservesBuilder(
        source,
        modelType,
        methodName,
        [],
      )
    ) {
      continue;
    }

    return null;
  }

  return collectionMethodName
    ? {
        collectionMethodName,
        modelType,
      }
    : null;
}

function phpLaravelEloquentBuilderExpressionCallPreservesBuilder(
  source: string,
  modelType: string,
  methodName: string,
  workspaceSources: readonly string[] = [],
): boolean {
  if (
    isLaravelEloquentBuilderMacroFromSource(
      source,
      methodName,
      workspaceSources,
    )
  ) {
    return phpLaravelEloquentBuilderMacroPreservesBuilder(
      source,
      methodName,
      workspaceSources,
    );
  }

  return (
    phpLaravelEloquentBuilderCallPreservesBuilder(
      source,
      modelType,
      methodName,
      workspaceSources,
    ) || phpLaravelEloquentBuilderExpressionCallMayBeScopeOrMacro(methodName)
  );
}

function phpLaravelEloquentBuilderExpressionCallMayBeScopeOrMacro(
  methodName: string,
): boolean {
  const normalizedMethodName = methodName.toLowerCase();

  return (
    !laravelEloquentBuilderTerminalModelMethods.has(normalizedMethodName) &&
    !laravelEloquentBuilderCollectionMethods.has(normalizedMethodName) &&
    !laravelEloquentBuilderNonModelTerminalMethods.has(normalizedMethodName)
  );
}

const ELOQUENT_BUILDER_MACRO_REGISTRAR_CLASS_NAME =
  "illuminate\\database\\eloquent\\builder";

/**
 * Registry of Laravel `Macroable` classes. Each entry maps the normalized FQN(s)
 * of the class(es) whose `::macro()` registers a macro to a receiver matcher that
 * decides which completion receiver types should be offered those macros. Adding
 * support for another Macroable class is a single entry, never a new branch.
 */
interface PhpLaravelMacroableClass {
  registrarClassNames: readonly string[];
  matchesReceiver: (resolvedReceiverClassName: string) => boolean;
}

function laravelMacroableReceiverMatcher(
  ...receiverClassNames: readonly string[]
): (resolvedReceiverClassName: string) => boolean {
  const receivers = new Set(receiverClassNames);

  return (resolvedReceiverClassName) =>
    receivers.has(normalizedLaravelClassName(resolvedReceiverClassName));
}

const laravelMacroableRegistry: readonly PhpLaravelMacroableClass[] = [
  {
    registrarClassNames: [ELOQUENT_BUILDER_MACRO_REGISTRAR_CLASS_NAME],
    matchesReceiver: laravelMacroableReceiverMatcher(
      ELOQUENT_BUILDER_MACRO_REGISTRAR_CLASS_NAME,
    ),
  },
  {
    registrarClassNames: ["illuminate\\database\\query\\builder"],
    matchesReceiver: laravelMacroableReceiverMatcher(
      "illuminate\\database\\query\\builder",
    ),
  },
  {
    registrarClassNames: ["illuminate\\support\\collection"],
    matchesReceiver: laravelMacroableReceiverMatcher(
      "illuminate\\support\\collection",
    ),
  },
  {
    registrarClassNames: ["illuminate\\database\\eloquent\\collection"],
    matchesReceiver: laravelMacroableReceiverMatcher(
      "illuminate\\database\\eloquent\\collection",
    ),
  },
  {
    registrarClassNames: ["illuminate\\database\\eloquent\\model"],
    matchesReceiver: (resolvedReceiverClassName) =>
      isLaravelModelType(resolvedReceiverClassName),
  },
];

interface PhpLaravelMacro {
  name: string;
  parameters: string;
  returnType: string | null;
  registrarClassName: string;
}

function laravelMacroRegistrarClassName(
  source: string,
  className: string,
): string | null {
  const candidate = phpDeclaredTypeCandidate(className) ?? className;
  const resolvedClassName = phpLaravelResolvedClassName(source, candidate);
  const normalized = normalizedLaravelClassName(resolvedClassName ?? candidate);

  return laravelMacroableRegistry.some((entry) =>
    entry.registrarClassNames.includes(normalized),
  )
    ? normalized
    : null;
}

function laravelMacroReceiverRegistrarClassNames(
  source: string,
  declaringClassName: string,
): ReadonlySet<string> | null {
  const candidate = phpDeclaredTypeCandidate(declaringClassName) ?? declaringClassName;
  const resolvedClassName =
    phpLaravelResolvedClassName(source, candidate) ?? candidate;
  const registrarClassNames = laravelMacroableRegistry
    .filter((entry) => entry.matchesReceiver(resolvedClassName))
    .flatMap((entry) => [...entry.registrarClassNames]);

  return registrarClassNames.length ? new Set(registrarClassNames) : null;
}

function phpLaravelMacrosFromSource(source: string): PhpLaravelMacro[] {
  const macros: PhpLaravelMacro[] = [];
  const seen = new Set<string>();
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*macro\s*\(/g;

  for (const match of masked.matchAll(pattern)) {
    const className = match[1];
    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!className || openOffset < 0) {
      continue;
    }

    const registrarClassName = laravelMacroRegistrarClassName(source, className);

    if (!registrarClassName) {
      continue;
    }

    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (closeOffset === null) {
      continue;
    }

    const args = splitPhpParameterList(source.slice(openOffset + 1, closeOffset));
    const name = phpLaravelMacroNameFromArgument(args[0] ?? "");

    if (!name) {
      continue;
    }

    const key = `${registrarClassName}::${name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    macros.push({
      name,
      registrarClassName,
      ...phpLaravelMacroClosureSignature(args[1] ?? ""),
    });
  }

  return macros;
}

function phpLaravelMacrosFromSources(
  source: string,
  workspaceSources: readonly string[] = [],
): PhpLaravelMacro[] {
  const macros: PhpLaravelMacro[] = [];
  const seen = new Set<string>();

  for (const candidateSource of [source, ...workspaceSources]) {
    for (const macro of phpLaravelMacrosFromSource(candidateSource)) {
      const key = `${macro.registrarClassName}::${macro.name.toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      macros.push(macro);
    }
  }

  return macros;
}

function phpLaravelEloquentBuilderMacroFromSource(
  source: string,
  methodName: string,
  workspaceSources: readonly string[] = [],
): PhpLaravelMacro | null {
  const lookupName = methodName.trim().toLowerCase();

  if (!lookupName) {
    return null;
  }

  return (
    phpLaravelMacrosFromSources(source, workspaceSources).find(
      (macro) =>
        macro.registrarClassName ===
          ELOQUENT_BUILDER_MACRO_REGISTRAR_CLASS_NAME &&
        macro.name.toLowerCase() === lookupName,
    ) ?? null
  );
}

function phpLaravelMacroReceiverClassNameFromExpression(
  receiverExpression: string,
): string | null {
  const trimmed = receiverExpression.trim();

  if (/^collect\s*\(/i.test(trimmed)) {
    return "Illuminate\\Support\\Collection";
  }

  return null;
}

function phpLaravelMacroNameFromArgument(argument: string): string | null {
  const match = /^\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(argument);

  return match?.[2] ?? null;
}

function phpLaravelMacroClosureSignature(
  expression: string,
): Pick<PhpLaravelMacro, "parameters" | "returnType"> {
  const functionMatch = /^\s*(?:static\s+)?function\s*\(/.exec(expression);
  const openOffset = functionMatch
    ? expression.indexOf("(", functionMatch.index)
    : -1;

  if (openOffset < 0) {
    return {
      parameters: "",
      returnType: null,
    };
  }

  const closeOffset = matchingPairOffset(expression, openOffset, "(", ")");

  if (closeOffset === null) {
    return {
      parameters: "",
      returnType: null,
    };
  }

  return {
    parameters: normalizeWhitespace(expression.slice(openOffset + 1, closeOffset)),
    returnType: normalizeReturnType(
      returnTypeAfterFunctionParameters(expression, closeOffset),
    ),
  };
}

function phpLaravelStaticCallChain(
  expression: string,
): PhpLaravelStaticCallChain | null {
  const normalized = expression
    .trim()
    .replace(/\s*->\s*/g, "->")
    .replace(/\s*::\s*/g, "::");
  const staticCallPattern = new RegExp(
    `^${PHP_CLASS_NAME_CAPTURE_PATTERN}::([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`,
  );
  const staticMatch = staticCallPattern.exec(normalized);

  if (!staticMatch?.[1] || !staticMatch[2]) {
    return null;
  }

  const methodNames = [staticMatch[2]];
  let openOffset = staticMatch[0].lastIndexOf("(");
  let closeOffset = matchingPairOffset(normalized, openOffset, "(", ")");

  if (closeOffset === null) {
    return null;
  }

  let offset = closeOffset + 1;

  while (offset < normalized.length) {
    const rest = normalized.slice(offset);

    if (!rest.trim()) {
      return {
        className: staticMatch[1].replace(/^\\+/, ""),
        methodNames,
      };
    }

    const memberMatch = /^\s*->([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(rest);

    if (!memberMatch?.[1]) {
      return null;
    }

    openOffset = offset + (memberMatch[0].lastIndexOf("(") ?? -1);
    closeOffset = matchingPairOffset(normalized, openOffset, "(", ")");

    if (openOffset < offset || closeOffset === null) {
      return null;
    }

    methodNames.push(memberMatch[1]);
    offset = closeOffset + 1;
  }

  return {
    className: staticMatch[1].replace(/^\\+/, ""),
    methodNames,
  };
}

function phpLaravelModelHasLocalScope(
  source: string,
  modelType: string,
  scopeName: string,
): boolean {
  const scopeMethodName = phpLaravelScopeMethodName(scopeName);

  if (!scopeMethodName) {
    return false;
  }

  return phpLaravelClassBodyRanges(source, modelType).some((range) => {
    const body = maskPhpStringsAndComments(
      source.slice(range.bodyStart, range.bodyEnd),
    );
    // Match only the function header. Stacked `#[...]` attributes are resolved
    // separately by walking backward from the declaration. The previous pattern
    // embedded `(?:#\[[\s\S]*?\]\s*)*` (a quantified lazy span) directly before
    // the `function` anchor, so a property carrying many stacked attributes -
    // where the anchor never arrives - drove exponential backtracking and
    // multi-second freezes during Eloquent builder type resolution.
    const pattern =
      /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

    for (const match of body.matchAll(pattern)) {
      const modifiers = (match[1] ?? "").toLowerCase();
      const methodName = match[2] ?? "";

      if (/\b(?:private|static)\b/.test(modifiers)) {
        continue;
      }

      if (methodName.toLowerCase() === scopeMethodName.toLowerCase()) {
        return true;
      }

      if (methodName.toLowerCase() !== scopeName.toLowerCase()) {
        continue;
      }

      // Offset of the declaration's first keyword (`match[0]` begins with the
      // leading `\n`/whitespace the pattern consumed). Walk back from there to
      // collect the stacked attributes that precede this specific method.
      const leadingWhitespace = match[0].length - match[0].trimStart().length;
      const declarationOffset = (match.index ?? 0) + leadingWhitespace;
      const attributes = phpLaravelStackedAttributeBlockBefore(
        body,
        declarationOffset,
      );

      if (phpLaravelAttributeBlockHasName(attributes, "Scope")) {
        return true;
      }
    }

    return false;
  });
}

// Returns the run of stacked `#[...]` attribute blocks that immediately precede
// `declarationOffset` in `masked` (a string/comment-masked class body where `#`
// is preserved). Walks backward, matching each `]` to its `#[` via a linear
// balanced-bracket scan - the safe replacement for the quantified lazy
// `(?:#\[[\s\S]*?\]\s*)*` span that previously caused exponential backtracking.
function phpLaravelStackedAttributeBlockBefore(
  masked: string,
  declarationOffset: number,
): string {
  let blockStart = declarationOffset;

  for (;;) {
    let cursor = blockStart - 1;

    while (cursor >= 0 && /\s/.test(masked[cursor] ?? "")) {
      cursor -= 1;
    }

    if (cursor < 0 || masked[cursor] !== "]") {
      break;
    }

    let depth = 0;
    let openOffset: number | null = null;

    for (let index = cursor; index >= 0; index -= 1) {
      const character = masked[index] || "";

      if (character === "]") {
        depth += 1;
        continue;
      }

      if (character !== "[") {
        continue;
      }

      depth -= 1;

      if (depth === 0) {
        openOffset = masked[index - 1] === "#" ? index - 1 : null;
        break;
      }
    }

    if (openOffset === null) {
      break;
    }

    blockStart = openOffset;
  }

  return masked.slice(blockStart, declarationOffset);
}

function phpLaravelAttributeBlockHasName(
  attributesSource: string,
  expectedName: string,
): boolean {
  const normalizedExpectedName = expectedName.toLowerCase();

  for (const match of attributesSource.matchAll(
    /(?:^|[\s,#[])(\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b/g,
  )) {
    const attributeName = match[1]?.replace(/^\\+/, "");
    const shortName = attributeName?.split("\\").pop()?.toLowerCase();

    if (
      attributeName?.toLowerCase() === normalizedExpectedName ||
      shortName === normalizedExpectedName
    ) {
      return true;
    }
  }

  return false;
}

function phpLaravelModelHasDynamicWhere(
  source: string,
  modelType: string,
  methodName: string,
): boolean {
  return (
    phpLaravelDynamicWhereAttributeOccurrencesForMethodFromOccurrences(
      methodName,
      phpLaravelDynamicWhereAttributeOccurrencesForModel(source, modelType),
    ).length > 0
  );
}

function phpLaravelClassBodyRanges(
  source: string,
  className: string,
): Array<{ bodyEnd: number; bodyStart: number }> {
  const ranges: Array<{ bodyEnd: number; bodyStart: number }> = [];
  const targetClassName = normalizedLaravelClassName(className);
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;

  for (const match of masked.matchAll(pattern)) {
    const candidateClassName = match[1] ?? "";
    const resolvedClassName = phpLaravelResolvedClassName(
      source,
      candidateClassName,
    );

    if (
      normalizedLaravelClassName(resolvedClassName ?? candidateClassName) !==
      targetClassName
    ) {
      continue;
    }

    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("{");
    const closeOffset = matchingPairOffset(source, openOffset, "{", "}");

    if (closeOffset === null) {
      continue;
    }

    ranges.push({
      bodyEnd: closeOffset,
      bodyStart: openOffset + 1,
    });
  }

  return ranges;
}

function phpLaravelRepositoryTypeBodyRanges(
  source: string,
  receiverClassName: string | null,
): Array<{ bodyEnd: number; bodyStart: number }> {
  const ranges: Array<{ bodyEnd: number; bodyStart: number }> = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/g;

  for (const match of masked.matchAll(pattern)) {
    const className = match[1] ?? "";
    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("{");
    const closeOffset = matchingPairOffset(source, openOffset, "{", "}");

    if (
      closeOffset === null ||
      !phpLaravelRepositoryTypeMatches(source, className, receiverClassName)
    ) {
      continue;
    }

    ranges.push({
      bodyEnd: closeOffset,
      bodyStart: openOffset + 1,
    });
  }

  return ranges;
}

function phpLaravelRepositoryTypeDocBlocks(
  source: string,
  receiverClassName: string | null,
): string[] {
  const docBlocks: string[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern = /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;

  for (const match of masked.matchAll(pattern)) {
    const className = match[1] ?? "";

    if (!phpLaravelRepositoryTypeMatches(source, className, receiverClassName)) {
      continue;
    }

    const docBlock = phpDocBlockBefore(source, match.index ?? 0);

    if (docBlock) {
      docBlocks.push(docBlock);
    }
  }

  return docBlocks;
}

function phpLaravelRepositoryTypeMatches(
  source: string,
  className: string,
  receiverClassName: string | null,
): boolean {
  const resolvedClassName = phpLaravelResolvedClassName(source, className);
  const normalizedReceiver = normalizedLaravelClassName(receiverClassName ?? "");

  if (!resolvedClassName || !normalizedReceiver) {
    return isLaravelRepositoryType(resolvedClassName ?? className);
  }

  return normalizedLaravelClassName(resolvedClassName) === normalizedReceiver;
}

function phpLaravelModelTypeFromReturnType(
  source: string,
  returnType: string | null,
): string | null {
  const candidate = phpDeclaredTypeCandidate(returnType ?? "");
  const resolvedClassName = phpLaravelResolvedClassName(source, candidate ?? "");

  if (!candidate || !resolvedClassName) {
    return null;
  }

  return isLaravelModelType(resolvedClassName) ? resolvedClassName : null;
}

function phpLaravelRepositoryConventionModelTypeFromReceiver(
  source: string,
  receiverType: string | null,
): string | null {
  const resolvedReceiverType =
    phpLaravelResolvedClassName(source, receiverType ?? "") ??
    receiverType?.trim().replace(/^\\+/, "");

  if (!isLaravelRepositoryType(resolvedReceiverType ?? null)) {
    return null;
  }

  const repositoryShortName = resolvedReceiverType?.split("\\").pop() ?? "";
  const modelShortName = repositoryShortName
    .replace(/RepositoryInterface$/i, "")
    .replace(/Repository$/i, "");

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(modelShortName)) {
    return null;
  }

  const explicitlyImportedModel = phpLaravelResolvedClassName(
    source,
    modelShortName,
  );

  if (explicitlyImportedModel && isLaravelModelType(explicitlyImportedModel)) {
    return explicitlyImportedModel;
  }

  const receiverParts = (resolvedReceiverType ?? "")
    .split("\\")
    .filter(Boolean);
  const conventionSegmentIndex = receiverParts.findIndex((part) =>
    /^(?:repositories|repository|interfaces|contracts)$/i.test(part),
  );

  if (conventionSegmentIndex < 0) {
    return null;
  }

  const modelNamespace = receiverParts.slice(0, conventionSegmentIndex);

  if (!modelNamespace.length) {
    return null;
  }

  const modelClassName = [...modelNamespace, "Models", modelShortName].join("\\");

  return isLaravelModelType(modelClassName) ? modelClassName : null;
}

function phpLaravelResolvedClassName(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = className.trim().replace(/^\\+/, "");

  if (!normalizedClassName) {
    return null;
  }

  if (normalizedClassName.includes("\\")) {
    return normalizedClassName;
  }

  return resolvePhpClassName(source, normalizedClassName)?.replace(/^\\+/, "") ?? null;
}

function isLaravelRepositoryType(className: string | null): boolean {
  return Boolean(className && /repository(?:interface)?\b/i.test(className));
}

function isLaravelModelType(className: string): boolean {
  const normalized = className.trim().replace(/^\\+/, "");
  const shortName = normalized.split("\\").pop() ?? normalized;

  return normalized.includes("\\Models\\") || /Model$/.test(shortName);
}

interface PhpLaravelDynamicWhereAttributeOccurrence {
  attributeName: string;
  attributeOffset: number;
}

function phpLaravelDynamicWhereSuffix(attribute: string): string | null {
  const parts = attribute
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  return parts
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function phpLaravelDynamicWhereAttributeOccurrencesForMethod(
  source: string,
  methodName: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  return phpLaravelDynamicWhereAttributeOccurrencesForMethodFromOccurrences(
    methodName,
    phpLaravelDynamicWhereAttributeOccurrences(source),
  );
}

function phpLaravelDynamicWhereAttributeOccurrencesForMethodFromOccurrences(
  methodName: string,
  attributeOccurrences: PhpLaravelDynamicWhereAttributeOccurrence[],
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  const suffixSegments = phpLaravelDynamicWhereMethodSuffixSegments(methodName);

  if (!suffixSegments.length) {
    return [];
  }

  const attributeSuffixes = attributeOccurrences
    .map((occurrence) => ({
      occurrence,
      suffix: phpLaravelDynamicWhereSuffix(occurrence.attributeName),
    }))
    .filter(
      (
        item,
      ): item is {
        occurrence: PhpLaravelDynamicWhereAttributeOccurrence;
        suffix: string;
      } => Boolean(item.suffix),
    );
  const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [];

  for (const segment of suffixSegments) {
    const occurrence = attributeSuffixes.find(
      (item) => item.suffix.toLowerCase() === segment.toLowerCase(),
    )?.occurrence;

    if (!occurrence) {
      return [];
    }

    occurrences.push(occurrence);
  }

  return occurrences;
}

function phpLaravelDynamicWhereMethodSuffixSegments(
  methodName: string,
): string[] {
  const suffix = phpLaravelDynamicWhereMethodSuffix(methodName);

  if (!suffix) {
    return [];
  }

  const segments = suffix.split(/(?:And|Or)(?=[A-Z])/);

  return segments.every(Boolean) ? segments : [];
}

function phpLaravelDynamicWhereMethodSuffix(methodName: string): string | null {
  const normalizedMethodName = methodName.trim();
  const lowerMethodName = normalizedMethodName.toLowerCase();

  if (
    lowerMethodName.startsWith("orwhere") &&
    normalizedMethodName.length > "orWhere".length
  ) {
    return normalizedMethodName.slice("orWhere".length);
  }

  if (
    lowerMethodName.startsWith("where") &&
    normalizedMethodName.length > "where".length
  ) {
    return normalizedMethodName.slice("where".length);
  }

  return null;
}

function phpLaravelDynamicWhereAttributeOccurrences(
  source: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [
    ...phpArrayStringValueOccurrences(source, "fillable"),
    ...phpArrayStringValueOccurrences(source, "dates"),
    ...phpArrayKeyOccurrences(source, "attributes"),
    ...phpArrayKeyOccurrences(source, "casts"),
  ];

  return phpLaravelDedupeAttributeOccurrences(occurrences);
}

function phpLaravelDynamicWhereAttributeOccurrencesForModel(
  source: string,
  modelType: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  const occurrences = phpLaravelClassBodyRanges(source, modelType).flatMap(
    (range) =>
      phpLaravelDynamicWhereAttributeOccurrences(
        source.slice(range.bodyStart, range.bodyEnd),
      ).map((occurrence) => ({
        ...occurrence,
        attributeOffset: range.bodyStart + occurrence.attributeOffset,
      })),
  );
  const tableName = phpLaravelModelTableNameFromSource(source, modelType);

  if (
    tableName &&
    phpLaravelSourceHasSchemaColumns(source) &&
    source.includes(tableName)
  ) {
    occurrences.push(...phpLaravelSchemaAttributeOccurrences(source, tableName));
  }

  return phpLaravelDedupeAttributeOccurrences(occurrences);
}

function phpLaravelDedupeAttributeOccurrences<
  T extends PhpLaravelDynamicWhereAttributeOccurrence,
>(occurrences: T[]): T[] {
  const seen = new Set<string>();

  return occurrences.filter((occurrence) => {
    const key = occurrence.attributeName.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizedLaravelClassName(className: string): string {
  return className.trim().replace(/^\\+/, "").toLowerCase();
}

function phpLaravelFillableAttributes(
  source: string,
  declaringClassName = "",
): string[] {
  return phpArrayAssignmentBodies(source, "fillable").flatMap((body) =>
    splitPhpParameterList(body)
      .map((item) =>
        phpLaravelAttributeNameFromExpression(source, declaringClassName, item),
      )
      .filter(isPhpAttributeName),
  );
}

function phpLaravelAppendedAttributes(
  source: string,
  declaringClassName = "",
): string[] {
  return phpArrayAssignmentBodies(source, "appends").flatMap((body) =>
    splitPhpParameterList(body)
      .map((item) =>
        phpLaravelAttributeNameFromExpression(source, declaringClassName, item),
      )
      .filter(isPhpAttributeName),
  );
}

function phpLaravelDateAttributes(
  source: string,
  declaringClassName = "",
): string[] {
  return phpArrayAssignmentBodies(source, "dates").flatMap((body) =>
    splitPhpParameterList(body)
      .map((item) =>
        phpLaravelAttributeNameFromExpression(source, declaringClassName, item),
      )
      .filter(isPhpAttributeName),
  );
}

function phpLaravelDefaultAttributes(
  source: string,
  declaringClassName = "",
): Array<[string, string | null]> {
  return phpArrayAssignmentBodies(source, "attributes").flatMap((body) =>
    splitPhpParameterList(body).flatMap((item) => {
      const arrowIndex = topLevelArrayArrowIndex(item);

      if (arrowIndex < 0) {
        return [];
      }

      const attribute = phpLaravelAttributeNameFromExpression(
        source,
        declaringClassName,
        item.slice(0, arrowIndex),
      );

      if (!isPhpAttributeName(attribute)) {
        return [];
      }

      return [
        [
          attribute,
          phpLaravelDefaultAttributeReturnType(item.slice(arrowIndex + 2)),
        ] satisfies [string, string | null],
      ];
    }),
  );
}

function phpLaravelCastAttributes(
  source: string,
  declaringClassName = "",
): Array<[string, string | null]> {
  return phpLaravelCastAttributeBodies(source).flatMap((body) =>
    phpLaravelCastAttributesFromBody(source, body, declaringClassName),
  );
}

function phpLaravelSchemaAttributesForModel(
  source: string,
  declaringClassName: string,
): Array<[string, string | null]> {
  const tableName = phpLaravelModelTableNameFromSource(
    source,
    declaringClassName,
  );

  if (
    !tableName ||
    !phpLaravelSourceHasSchemaColumns(source) ||
    !source.includes(tableName)
  ) {
    return [];
  }

  return phpLaravelSchemaAttributeOccurrences(source, tableName).map(
    (occurrence) => [occurrence.attributeName, occurrence.returnType],
  );
}

// Resolves the model's table (explicit `$table` or Laravel naming convention)
// and merges DB columns parsed from the migration files supplied as
// `workspaceSources`. Conservative by design: returns nothing when the table
// cannot be determined or no supplied migration touches it, so callers fall
// back to the existing $fillable/$casts-derived attributes. Per-workspace
// isolation is preserved because the migration sources are passed in by the
// caller for the active project root only.
function phpLaravelMigrationSchemaAttributesForModel(
  modelSource: string,
  declaringClassName: string,
  workspaceSources: readonly string[],
): Array<[string, string | null]> {
  if (workspaceSources.length === 0) {
    return [];
  }

  const tableName = phpLaravelModelTableNameFromSource(
    modelSource,
    declaringClassName,
  );

  if (!tableName) {
    return [];
  }

  const columns = new Map<string, string | null>();

  for (const workspaceSource of workspaceSources) {
    if (
      !phpLaravelSourceHasSchemaColumns(workspaceSource) ||
      !workspaceSource.includes(tableName)
    ) {
      continue;
    }

    for (const occurrence of phpLaravelSchemaAttributeOccurrences(
      workspaceSource,
      tableName,
    )) {
      if (!columns.has(occurrence.attributeName)) {
        columns.set(occurrence.attributeName, occurrence.returnType);
      }
    }
  }

  return Array.from(columns);
}

function phpLaravelModelTableNameFromSource(
  source: string,
  declaringClassName: string,
): string | null {
  for (const range of phpLaravelClassBodyRanges(source, declaringClassName)) {
    const body = source.slice(range.bodyStart, range.bodyEnd);
    const maskedBody = maskPhpStringsAndComments(body);
    const pattern = /\$table\s*=/g;

    for (const match of maskedBody.matchAll(pattern)) {
      const literal = phpStringLiteralAtOffset(
        source,
        range.bodyStart + (match.index ?? 0) + (match[0]?.length ?? 0),
      );

      if (literal?.value) {
        return literal.value;
      }
    }
  }

  return phpLaravelConventionalModelTableName(declaringClassName);
}

function phpLaravelConventionalModelTableName(className: string): string | null {
  const shortName = className.trim().replace(/^\\+/, "").split("\\").pop();

  if (!shortName) {
    return null;
  }

  return `${phpCamelCaseToSnakeCase(shortName)}s`;
}

interface PhpLaravelSchemaAttributeOccurrence
  extends PhpLaravelDynamicWhereAttributeOccurrence {
  returnType: string | null;
  tableName: string;
}

type PhpLaravelSchemaColumn = Pick<
  PhpLaravelSchemaAttributeOccurrence,
  "attributeName" | "attributeOffset" | "returnType"
>;

function phpLaravelSchemaAttributeOccurrences(
  source: string,
  tableName?: string,
): PhpLaravelSchemaAttributeOccurrence[] {
  if (!phpLaravelSourceHasSchemaColumns(source)) {
    return [];
  }

  const masked = maskPhpStringsAndComments(source);
  const occurrences: PhpLaravelSchemaAttributeOccurrence[] = [];
  const pattern = /\bSchema\s*::\s*(?:create|table)\s*\(/g;

  for (const match of masked.matchAll(pattern)) {
    const matched = match[0] ?? "";
    const openOffset = (match.index ?? 0) + matched.lastIndexOf("(");
    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (closeOffset === null) {
      continue;
    }

    const argumentRanges = splitPhpParameterRanges(
      source,
      openOffset + 1,
      closeOffset,
    );
    const schemaTableName = phpStringLiteralValue(
      argumentRanges[0]?.value ?? "",
    );

    if (!schemaTableName || (tableName && schemaTableName !== tableName)) {
      continue;
    }

    const closure = argumentRanges
      .slice(1)
      .map((range) => phpLaravelSchemaClosureFromArgument(source, masked, range))
      .find((candidate): candidate is PhpLaravelSchemaClosure =>
        Boolean(candidate),
      );

    if (!closure) {
      continue;
    }

    occurrences.push(
      ...phpLaravelSchemaColumnsFromClosure(source, masked, closure).map(
        (column) => ({
          ...column,
          tableName: schemaTableName,
        }),
      ),
    );
  }

  return occurrences;
}

function phpLaravelSourceHasSchemaColumns(source: string): boolean {
  return source.includes("Schema::create") || source.includes("Schema::table");
}

interface PhpParameterRange {
  endOffset: number;
  startOffset: number;
  value: string;
}

function splitPhpParameterRanges(
  source: string,
  startOffset: number,
  endOffset: number,
): PhpParameterRange[] {
  const ranges: PhpParameterRange[] = [];
  let itemStart = startOffset;
  let depth = 0;
  let quote: string | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    const range = phpParameterRange(source, itemStart, index);

    if (range) {
      ranges.push(range);
    }

    itemStart = index + 1;
  }

  const range = phpParameterRange(source, itemStart, endOffset);

  if (range) {
    ranges.push(range);
  }

  return ranges;
}

function phpParameterRange(
  source: string,
  startOffset: number,
  endOffset: number,
): PhpParameterRange | null {
  let trimmedStart = startOffset;
  let trimmedEnd = endOffset;

  while (trimmedStart < trimmedEnd && /\s/.test(source[trimmedStart] ?? "")) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && /\s/.test(source[trimmedEnd - 1] ?? "")) {
    trimmedEnd -= 1;
  }

  if (trimmedStart >= trimmedEnd) {
    return null;
  }

  return {
    endOffset: trimmedEnd,
    startOffset: trimmedStart,
    value: source.slice(trimmedStart, trimmedEnd),
  };
}

interface PhpLaravelSchemaClosure {
  bodyEnd: number;
  bodyStart: number;
  tableVariable: string;
}

function phpLaravelSchemaClosureFromArgument(
  source: string,
  masked: string,
  range: PhpParameterRange,
): PhpLaravelSchemaClosure | null {
  const functionMatch = /\bfunction\s*\(/.exec(
    masked.slice(range.startOffset, range.endOffset),
  );

  if (!functionMatch) {
    return null;
  }

  const parametersOpen =
    range.startOffset +
    functionMatch.index +
    (functionMatch[0]?.lastIndexOf("(") ?? 0);
  const parametersClose = matchingPairOffset(source, parametersOpen, "(", ")");

  if (parametersClose === null || parametersClose > range.endOffset) {
    return null;
  }

  const firstParameter = splitPhpParameterList(
    source.slice(parametersOpen + 1, parametersClose),
  )[0];
  const tableVariable = /\$([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    firstParameter ?? "",
  )?.[1];

  if (!tableVariable) {
    return null;
  }

  const bodyStart = masked.indexOf("{", parametersClose + 1);

  if (bodyStart < 0 || bodyStart > range.endOffset) {
    return null;
  }

  const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

  if (bodyEnd === null || bodyEnd > range.endOffset) {
    return null;
  }

  return {
    bodyEnd,
    bodyStart: bodyStart + 1,
    tableVariable,
  };
}

function phpLaravelSchemaColumnsFromClosure(
  source: string,
  masked: string,
  closure: PhpLaravelSchemaClosure,
): PhpLaravelSchemaColumn[] {
  const body = masked.slice(closure.bodyStart, closure.bodyEnd);
  const pattern = new RegExp(
    `\\$${escapeRegExp(closure.tableVariable)}\\s*->\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`,
    "g",
  );
  const columns: PhpLaravelSchemaColumn[] = [];

  for (const match of body.matchAll(pattern)) {
    const methodName = match[1] ?? "";
    const openOffset =
      closure.bodyStart +
      (match.index ?? 0) +
      (match[0]?.lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (closeOffset === null || closeOffset > closure.bodyEnd) {
      continue;
    }

    columns.push(
      ...phpLaravelSchemaColumnsFromCall(
        source,
        methodName,
        openOffset,
        closeOffset,
      ),
    );
  }

  return columns;
}

const PHP_CARBON_TYPE = "\\Illuminate\\Support\\Carbon";

// Blueprint helpers that materialise one or more conventionally-named columns
// without taking the column name as their first argument (e.g. `$table->
// timestamps()` -> created_at + updated_at). Mapped to their default column
// names so migration-backed attribute completion surfaces them too.
const phpLaravelSchemaFixedColumnGroups = new Map<
  string,
  ReadonlyArray<readonly [string, string | null]>
>([
  ["timestamps", [["created_at", PHP_CARBON_TYPE], ["updated_at", PHP_CARBON_TYPE]]],
  ["timestampstz", [["created_at", PHP_CARBON_TYPE], ["updated_at", PHP_CARBON_TYPE]]],
  [
    "nullabletimestamps",
    [["created_at", PHP_CARBON_TYPE], ["updated_at", PHP_CARBON_TYPE]],
  ],
  ["softdeletes", [["deleted_at", PHP_CARBON_TYPE]]],
  ["softdeletestz", [["deleted_at", PHP_CARBON_TYPE]]],
  ["remembertoken", [["remember_token", "string"]]],
]);

function phpLaravelSchemaColumnsFromCall(
  source: string,
  methodName: string,
  openOffset: number,
  closeOffset: number,
): PhpLaravelSchemaColumn[] {
  const fixedColumns = phpLaravelSchemaFixedColumnGroups.get(
    methodName.toLowerCase(),
  );

  if (fixedColumns) {
    return fixedColumns.map(([attributeName, returnType]) => ({
      attributeName,
      attributeOffset: openOffset - methodName.length,
      returnType,
    }));
  }

  const column = phpLaravelSchemaColumnFromCall(
    source,
    methodName,
    openOffset,
    closeOffset,
  );

  return column ? [column] : [];
}

function phpLaravelSchemaColumnFromCall(
  source: string,
  methodName: string,
  openOffset: number,
  closeOffset: number,
): PhpLaravelSchemaColumn | null {
  const normalizedMethodName = methodName.toLowerCase();

  if (!phpLaravelSchemaColumnMethodNames.has(normalizedMethodName)) {
    return null;
  }

  if (normalizedMethodName === "id") {
    return {
      attributeName: "id",
      attributeOffset: openOffset - methodName.length,
      returnType: "int",
    };
  }

  const firstArgument = splitPhpParameterRanges(
    source,
    openOffset + 1,
    closeOffset,
  )[0];
  const literal = firstArgument
    ? phpStringLiteralAtOffset(source, firstArgument.startOffset)
    : null;

  if (!literal || !isPhpAttributeName(literal.value)) {
    return null;
  }

  return {
    attributeName: literal.value,
    attributeOffset: literal.valueOffset,
    returnType: phpLaravelSchemaColumnReturnType(methodName),
  };
}

const phpLaravelSchemaColumnMethodNames = new Set([
  "bigincrements",
  "biginteger",
  "binary",
  "boolean",
  "char",
  "date",
  "datetime",
  "datetimetz",
  "decimal",
  "double",
  "enum",
  "float",
  "foreignid",
  "foreignulid",
  "foreignuuid",
  "geometry",
  "geometrycollection",
  "id",
  "increments",
  "integer",
  "ipaddress",
  "json",
  "jsonb",
  "linestring",
  "longtext",
  "macaddress",
  "mediumincrements",
  "mediuminteger",
  "mediumtext",
  "multilinestring",
  "multipoint",
  "multipolygon",
  "point",
  "polygon",
  "set",
  "smallincrements",
  "smallinteger",
  "string",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "timetz",
  "tinyincrements",
  "tinyinteger",
  "ulid",
  "unsignedbiginteger",
  "unsigneddecimal",
  "unsignedinteger",
  "unsignedmediuminteger",
  "unsignedsmallinteger",
  "unsignedtinyinteger",
  "uuid",
  "year",
]);

function phpLaravelSchemaColumnReturnType(methodName: string): string | null {
  const normalized = methodName.toLowerCase();

  if (
    /(?:^|_)(?:id|increments)$/.test(normalized) ||
    normalized.includes("integer")
  ) {
    return "int";
  }

  if (normalized.includes("boolean")) {
    return "bool";
  }

  if (
    normalized.includes("float") ||
    normalized.includes("double") ||
    normalized.includes("decimal")
  ) {
    return "float";
  }

  if (
    normalized.includes("date") ||
    normalized.includes("time") ||
    normalized.includes("timestamp")
  ) {
    return "\\Illuminate\\Support\\Carbon";
  }

  if (
    normalized.includes("json") ||
    normalized === "set" ||
    normalized === "enum"
  ) {
    return "array";
  }

  if (
    normalized.includes("string") ||
    normalized.includes("text") ||
    normalized === "char" ||
    normalized === "uuid" ||
    normalized === "ulid"
  ) {
    return "string";
  }

  return "mixed";
}

function phpLaravelCastAttributeBodies(source: string): string[] {
  return [
    ...phpArrayAssignmentBodies(source, "casts"),
    ...phpMethodReturnExpressions(source, "casts").flatMap((expression) => {
      const body = phpArrayExpressionBody(expression);

      return body ? [body] : [];
    }),
  ];
}

function phpLaravelCastAttributesFromBody(
  source: string,
  body: string,
  declaringClassName = "",
): Array<[string, string | null]> {
  return splitPhpParameterList(body).flatMap((item) => {
    const arrowIndex = topLevelArrayArrowIndex(item);

    if (arrowIndex < 0) {
      return [];
    }

    const attribute = phpLaravelAttributeNameFromExpression(
      source,
      declaringClassName,
      item.slice(0, arrowIndex),
    );

    if (!isPhpAttributeName(attribute)) {
      return [];
    }

    return [
      [
        attribute,
        phpLaravelCastReturnType(source, item.slice(arrowIndex + 2)),
      ] satisfies [string, string | null],
    ];
  });
}

function phpLaravelAttributeNameFromExpression(
  source: string,
  declaringClassName: string,
  expression: string,
): string | null {
  const literalAttribute = phpStringLiteralValue(expression);

  if (literalAttribute !== null) {
    return literalAttribute;
  }

  if (!declaringClassName) {
    return null;
  }

  return phpStringConstantExpressionValueFromSource(
    source,
    declaringClassName,
    expression,
  );
}

function phpStringConstantExpressionValueFromSource(
  source: string,
  declaringClassName: string,
  expression: string,
  visitedConstantNames: Set<string> = new Set(),
): string | null {
  const value = stripOuterParentheses(expression.trim());
  const constantMatch =
    /^((?:self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*(?!class\b)([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
      value,
    );
  const ownerName = constantMatch?.[1]?.replace(/^\\+/, "") ?? null;
  const constantName = constantMatch?.[2] ?? null;

  return ownerName && constantName
    ? phpStringConstantValueFromSource(
        source,
        declaringClassName,
        ownerName,
        constantName,
        visitedConstantNames,
      )
    : null;
}

function phpStringConstantValueFromSource(
  source: string,
  declaringClassName: string,
  ownerName: string,
  constantName: string,
  visitedConstantNames: Set<string>,
): string | null {
  const ownerClassName = phpClassNameForConstantExpression(
    source,
    declaringClassName,
    ownerName,
  );

  if (!ownerClassName) {
    return null;
  }

  const visitKey = `${ownerClassName.toLowerCase()}::${constantName.toLowerCase()}`;

  if (visitedConstantNames.has(visitKey)) {
    return null;
  }

  const body = phpClassBodyForClassName(source, ownerClassName);

  if (!body) {
    return null;
  }

  visitedConstantNames.add(visitKey);

  for (const statement of phpClassConstStatements(body)) {
    for (const item of splitPhpParameterList(statement)) {
      const assignmentMatch =
        /^(?:[\s\S]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(
          item.trim(),
        );
      const name = assignmentMatch?.[1] ?? null;
      const value = assignmentMatch?.[2]?.trim() ?? null;

      if (!name || !value || name.toLowerCase() !== constantName.toLowerCase()) {
        continue;
      }

      return phpStringConstantExpressionValue(
        source,
        ownerClassName,
        value,
        visitedConstantNames,
      );
    }
  }

  return null;
}

function phpStringConstantExpressionValue(
  source: string,
  ownerClassName: string,
  expression: string,
  visitedConstantNames: Set<string>,
): string | null {
  const value = stripOuterParentheses(expression);
  const literalValue = phpStringLiteralValue(value);

  if (literalValue !== null) {
    return literalValue;
  }

  return phpStringConstantExpressionValueFromSource(
    source,
    ownerClassName,
    value,
    visitedConstantNames,
  );
}

function phpLaravelAccessorAttributes(
  source: string,
): Array<[string, string | null]> {
  return phpLaravelAccessorAttributeMatches(source).map((match) => [
    match.attributeName,
    match.returnType,
  ]);
}

interface PhpLaravelAccessorAttributeMatch {
  attributeName: string;
  methodOffset: number;
  returnType: string | null;
}

function phpLaravelAccessorAttributeMatches(
  source: string,
): PhpLaravelAccessorAttributeMatch[] {
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;
  const matches: PhpLaravelAccessorAttributeMatch[] = [];

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (/\bprivate\b/.test(modifiers)) {
      continue;
    }

    const name = match[2];

    if (!name) {
      continue;
    }

    const functionOffset = (match.index ?? 0) + match[0].lastIndexOf("function");
    const methodOffset =
      (match.index ?? 0) + match[0].indexOf(name, match[0].lastIndexOf("function"));
    const docBlock = phpDocBlockBefore(source, functionOffset);
    const declaredReturnType = normalizeReturnType(match[4] ?? null);
    const documentedReturnType = phpDocReturnTypeFromBlock(docBlock);
    const returnType = bestPhpReturnType(declaredReturnType, documentedReturnType);
    const legacyAccessorName = phpLaravelLegacyAccessorAttributeName(name);

    if (legacyAccessorName) {
      matches.push({
        attributeName: legacyAccessorName,
        methodOffset,
        returnType: returnType ?? "mixed",
      });
      continue;
    }

    if (phpLaravelAttributeAccessorReturnType(returnType)) {
      matches.push({
        attributeName: phpCamelCaseToSnakeCase(name),
        methodOffset,
        returnType:
          phpLaravelAttributeAccessorValueType(returnType) ??
          phpLaravelAttributeAccessorValueTypeFromReturnExpression(source, name) ??
          "mixed",
      });
    }
  }

  return matches;
}

function phpArrayAssignmentBodies(source: string, propertyName: string): string[] {
  return phpArrayAssignmentRanges(source, propertyName).map((range) => range.body);
}

interface PhpArrayAssignmentRange {
  body: string;
  bodyOffset: number;
}

function phpArrayAssignmentRanges(
  source: string,
  propertyName: string,
): PhpArrayAssignmentRange[] {
  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    `\\$${propertyName}\\s*=\\s*(?:\\[|array\\s*\\()`,
    "g",
  );
  const ranges: PhpArrayAssignmentRange[] = [];

  for (const match of masked.matchAll(pattern)) {
    const matched = match[0] ?? "";
    const shortArrayOffset = matched.lastIndexOf("[");
    const arrayCallOffset = matched.lastIndexOf("(");
    const isShortArray = shortArrayOffset > arrayCallOffset;
    const openOffset =
      match.index + (isShortArray ? shortArrayOffset : arrayCallOffset);
    const closeOffset = matchingPairOffset(
      source,
      openOffset,
      isShortArray ? "[" : "(",
      isShortArray ? "]" : ")",
    );

    if (closeOffset === null) {
      continue;
    }

    ranges.push({
      body: source.slice(openOffset + 1, closeOffset),
      bodyOffset: openOffset + 1,
    });
  }

  return ranges;
}

function phpArrayStringValueOccurrences(
  source: string,
  propertyName: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  return phpArrayAssignmentRanges(source, propertyName).flatMap((range) => {
    const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [];
    const pattern = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g;

    for (const match of range.body.matchAll(pattern)) {
      const attributeName = match[2] ?? "";

      if (!isPhpAttributeName(attributeName)) {
        continue;
      }

      occurrences.push({
        attributeName,
        attributeOffset: range.bodyOffset + (match.index ?? 0) + 1,
      });
    }

    return occurrences;
  });
}

function phpArrayKeyOccurrences(
  source: string,
  propertyName: string,
): PhpLaravelDynamicWhereAttributeOccurrence[] {
  return phpArrayAssignmentRanges(source, propertyName).flatMap((range) => {
    const occurrences: PhpLaravelDynamicWhereAttributeOccurrence[] = [];
    const pattern = /(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*=>/g;

    for (const match of range.body.matchAll(pattern)) {
      const attributeName = match[2] ?? "";

      if (!isPhpAttributeName(attributeName)) {
        continue;
      }

      occurrences.push({
        attributeName,
        attributeOffset: range.bodyOffset + (match.index ?? 0) + 1,
      });
    }

    return occurrences;
  });
}

function phpArrayExpressionBody(expression: string): string | null {
  const trimmed = expression.trim();
  const shortArrayOffset = trimmed.search(/\[/);
  const arrayCallMatch = /\barray\s*\(/i.exec(trimmed);
  const arrayCallOffset = arrayCallMatch?.index ?? -1;

  if (
    shortArrayOffset >= 0 &&
    (arrayCallOffset < 0 || shortArrayOffset < arrayCallOffset)
  ) {
    const closeOffset = matchingPairOffset(trimmed, shortArrayOffset, "[", "]");

    return closeOffset === null
      ? null
      : trimmed.slice(shortArrayOffset + 1, closeOffset);
  }

  if (arrayCallOffset >= 0) {
    const openOffset =
      arrayCallOffset + (arrayCallMatch?.[0].lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(trimmed, openOffset, "(", ")");

    return closeOffset === null ? null : trimmed.slice(openOffset + 1, closeOffset);
  }

  return null;
}

function phpLaravelCastReturnType(
  source: string,
  castExpression: string,
): string | null {
  const classConstantType = phpLaravelCastClassConstantType(
    source,
    castExpression,
  );

  if (classConstantType) {
    return classConstantType;
  }

  const normalized = normalizeWhitespace(
    phpStringLiteralValue(castExpression) ?? castExpression,
  )
    .replace(/^\\+/, "")
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("array") || normalized.includes("json")) {
    return "array";
  }

  if (normalized.includes("collection")) {
    return "\\Illuminate\\Support\\Collection";
  }

  if (/\b(?:bool|boolean)\b/.test(normalized)) {
    return "bool";
  }

  if (/\b(?:int|integer)\b/.test(normalized)) {
    return "int";
  }

  if (/\b(?:real|float|double)\b/.test(normalized)) {
    return "float";
  }

  if (normalized.startsWith("decimal")) {
    return "string";
  }

  if (
    normalized === "date" ||
    normalized === "datetime" ||
    normalized.startsWith("immutable_date") ||
    normalized.startsWith("immutable_datetime")
  ) {
    return "\\Illuminate\\Support\\Carbon";
  }

  if (
    normalized === "string" ||
    normalized === "encrypted" ||
    normalized === "hashed"
  ) {
    return "string";
  }

  if (normalized.includes("asstringable") || normalized.includes("stringable")) {
    return "\\Illuminate\\Support\\Stringable";
  }

  return "mixed";
}

function phpLaravelCastClassConstantType(
  source: string,
  castExpression: string,
): string | null {
  const match =
    /^\s*(\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*\s*::\s*class\b/.exec(
      castExpression,
    );
  const className = match?.[0]
    ?.replace(/\s*::\s*class\b.*/i, "")
    .trim();

  return className ? resolvePhpClassName(source, className) : null;
}

function phpLaravelDefaultAttributeReturnType(
  valueExpression: string,
): string | null {
  const value = valueExpression.trim();

  if (!value) {
    return "mixed";
  }

  if (phpStringLiteralValue(value) !== null) {
    return "string";
  }

  if (/^(?:true|false)$/i.test(value)) {
    return "bool";
  }

  if (/^-?\d+$/.test(value)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+)$/i.test(value)) {
    return "float";
  }

  if (/^null$/i.test(value)) {
    return "mixed";
  }

  if (/^(?:\[|array\s*\()/i.test(value)) {
    return "array";
  }

  return "mixed";
}

function phpLaravelLegacyAccessorAttributeName(methodName: string): string | null {
  const match = /^get([A-Z][A-Za-z0-9_]*)Attribute$/.exec(methodName);
  const attributeName = match?.[1] ?? "";

  return attributeName ? phpCamelCaseToSnakeCase(attributeName) : null;
}

function phpLaravelAttributeAccessorReturnType(returnType: string | null): boolean {
  if (!returnType) {
    return false;
  }

  const baseType = returnType
    .trim()
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.split("\\")
    .pop()
    ?.toLowerCase();

  return baseType === "attribute";
}

function phpLaravelAttributeAccessorValueType(
  returnType: string | null,
): string | null {
  if (!returnType) {
    return null;
  }

  return normalizeReturnType(firstPhpGenericTypeArgument(returnType));
}

function phpLaravelAttributeAccessorValueTypeFromReturnExpression(
  source: string,
  methodName: string,
): string | null {
  return phpMethodReturnExpressions(source, methodName)
    .map((expression) =>
      phpLaravelAttributeAccessorValueTypeFromExpression(source, expression),
    )
    .find((returnType): returnType is string => Boolean(returnType)) ?? null;
}

function phpLaravelAttributeAccessorValueTypeFromExpression(
  source: string,
  expression: string,
): string | null {
  const factoryCall = phpLaravelAttributeAccessorFactoryCall(expression);

  if (!factoryCall) {
    return null;
  }

  const getterExpression =
    factoryCall.methodName === "get"
      ? phpFirstPositionalArgument(factoryCall.argumentsSource)
      : phpNamedArgumentExpression(factoryCall.argumentsSource, "get") ??
        phpFirstPositionalArgument(factoryCall.argumentsSource);

  return getterExpression
    ? phpLaravelClosureValueType(source, getterExpression)
    : null;
}

interface PhpLaravelAttributeAccessorFactoryCall {
  argumentsSource: string;
  methodName: "get" | "make";
}

function phpLaravelAttributeAccessorFactoryCall(
  expression: string,
): PhpLaravelAttributeAccessorFactoryCall | null {
  const normalized = expression.trim();
  const pattern =
    /(?:^|[^A-Za-z0-9_\\])(?:\\?[A-Za-z_][A-Za-z0-9_]*\\)*Attribute\s*::\s*(make|get)\s*\(/g;

  for (const match of normalized.matchAll(pattern)) {
    const methodName = match[1];

    if (methodName !== "make" && methodName !== "get") {
      continue;
    }

    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingPairOffset(normalized, openOffset, "(", ")");

    if (closeOffset === null) {
      continue;
    }

    return {
      argumentsSource: normalized.slice(openOffset + 1, closeOffset),
      methodName,
    };
  }

  return null;
}

function phpNamedArgumentExpression(
  argumentsSource: string,
  argumentName: string,
): string | null {
  const normalizedArgumentName = argumentName.toLowerCase();

  for (const argument of splitPhpParameterList(argumentsSource)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(
      argument,
    );

    if (match?.[1]?.toLowerCase() === normalizedArgumentName) {
      return match[2]?.trim() || null;
    }
  }

  return null;
}

function phpFirstPositionalArgument(argumentsSource: string): string | null {
  const firstArgument = splitPhpParameterList(argumentsSource)[0]?.trim();

  if (!firstArgument || /^[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/.test(firstArgument)) {
    return null;
  }

  return firstArgument;
}

function phpLaravelClosureValueType(
  source: string,
  expression: string,
): string | null {
  const declaredReturnType = phpClosureDeclaredReturnType(expression);

  if (declaredReturnType) {
    return phpLaravelAccessorValueType(source, declaredReturnType);
  }

  const arrowIndex = topLevelArrowIndex(expression);

  if (arrowIndex < 0) {
    return null;
  }

  return phpLaravelValueExpressionType(source, expression.slice(arrowIndex + 2));
}

function phpClosureDeclaredReturnType(expression: string): string | null {
  const normalized = expression.trim();
  const arrowFunctionMatch = /^(?:static\s+)?fn\s*\(/.exec(normalized);

  if (arrowFunctionMatch) {
    const parametersStart = normalized.indexOf("(", arrowFunctionMatch.index ?? 0);
    const parametersEnd = matchingPairOffset(normalized, parametersStart, "(", ")");

    if (parametersEnd === null) {
      return null;
    }

    const afterParameters = normalized.slice(parametersEnd + 1);
    const match = /^\s*:\s*([\s\S]+?)\s*=>/.exec(afterParameters);

    return normalizeReturnType(match?.[1] ?? null);
  }

  const anonymousFunctionMatch =
    /^(?:static\s+)?function\s*&?\s*\(/.exec(normalized);

  if (!anonymousFunctionMatch) {
    return null;
  }

  const parametersStart = normalized.indexOf(
    "(",
    anonymousFunctionMatch.index ?? 0,
  );
  const parametersEnd = matchingPairOffset(normalized, parametersStart, "(", ")");

  if (parametersEnd === null) {
    return null;
  }

  let afterParameters = normalized.slice(parametersEnd + 1).trimStart();

  if (afterParameters.startsWith("use")) {
    const useParametersStart = afterParameters.indexOf("(");
    const useParametersEnd =
      useParametersStart >= 0
        ? matchingPairOffset(afterParameters, useParametersStart, "(", ")")
        : null;

    if (useParametersEnd !== null) {
      afterParameters = afterParameters.slice(useParametersEnd + 1).trimStart();
    }
  }

  const match = /^:\s*([^{]+)\s*\{/.exec(afterParameters);

  return normalizeReturnType(match?.[1] ?? null);
}

function phpLaravelAccessorValueType(
  source: string,
  returnType: string,
): string | null {
  const normalized = normalizeReturnType(returnType)?.replace(/^\?/, "") ?? null;

  if (!normalized) {
    return null;
  }

  const candidate = phpDeclaredTypeCandidate(normalized);
  const resolvedCandidate = candidate ? resolvePhpClassName(source, candidate) : null;

  return resolvedCandidate ?? normalized;
}

function phpLaravelValueExpressionType(
  source: string,
  expression: string,
): string | null {
  const value = stripOuterParentheses(expression.trim());

  if (!value) {
    return null;
  }

  if (phpStringLiteralValue(value) !== null) {
    return "string";
  }

  if (/^(?:true|false)$/i.test(value)) {
    return "bool";
  }

  if (/^-?\d+$/.test(value)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+)$/i.test(value)) {
    return "float";
  }

  if (/^null$/i.test(value)) {
    return "mixed";
  }

  if (/^(?:\[|array\s*\()/i.test(value)) {
    return "array";
  }

  const newExpressionMatch =
    /^new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*\(/.exec(
      value,
    );
  const className = newExpressionMatch?.[1]?.replace(/^\\+/, "") ?? null;

  return className ? resolvePhpClassName(source, className) ?? className : null;
}

function stripOuterParentheses(expression: string): string {
  let value = expression.trim();

  while (value.startsWith("(")) {
    const closeOffset = matchingPairOffset(value, 0, "(", ")");

    if (closeOffset !== value.length - 1) {
      break;
    }

    value = value.slice(1, -1).trim();
  }

  return value;
}

export function phpLaravelRelationTargetClassNameFromExpression(
  expression: string,
  includeCollectionRelations: boolean,
  localClassStringResolver?: (variableName: string) => string | null,
  classStringExpressionResolver?: (expression: string) => string | null,
): string | null {
  const normalizedExpression = expression.trim();
  const pattern =
    /\b(belongsTo|belongsToMany|hasMany|hasManyThrough|hasOne|hasOneThrough|morphMany|morphOne|morphedByMany|morphToMany)\s*\(/g;

  for (const match of normalizedExpression.matchAll(pattern)) {
    const relationType = match[1]?.toLowerCase();

    if (!relationType) {
      continue;
    }

    if (
      !includeCollectionRelations &&
      !laravelEloquentSingularRelationTypes.has(relationType)
    ) {
      continue;
    }

    const openOffset = (match.index ?? 0) + (match[0]?.lastIndexOf("(") ?? 0);
    const closeOffset = matchingPairOffset(
      normalizedExpression,
      openOffset,
      "(",
      ")",
    );

    if (closeOffset === null) {
      continue;
    }

    const targetClassName = phpLaravelRelationTargetClassNameFromArguments(
      normalizedExpression.slice(openOffset + 1, closeOffset),
      localClassStringResolver,
      classStringExpressionResolver,
    );

    if (targetClassName) {
      return targetClassName;
    }
  }

  return null;
}

function phpLaravelHasRelationFactoryCallInExpression(
  expression: string,
  includeCollectionRelations: boolean,
): boolean {
  const normalizedExpression = expression.trim();
  const pattern =
    /\b(belongsTo|belongsToMany|hasMany|hasManyThrough|hasOne|hasOneThrough|morphMany|morphOne|morphedByMany|morphTo|morphToMany)\s*\(/g;

  for (const match of normalizedExpression.matchAll(pattern)) {
    const relationType = match[1]?.toLowerCase();

    if (!relationType) {
      continue;
    }

    if (
      !includeCollectionRelations &&
      !laravelEloquentSingularRelationTypes.has(relationType)
    ) {
      continue;
    }

    return true;
  }

  return false;
}

function phpLaravelRelationTargetClassNameFromArguments(
  argumentsSource: string,
  localClassStringResolver?: (variableName: string) => string | null,
  classStringExpressionResolver?: (expression: string) => string | null,
): string | null {
  const classNamePattern =
    String.raw`(?:__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;
  const classNameReferencePattern = new RegExp(
    String.raw`^(` + classNamePattern + String.raw`)\s*::\s*class\b`,
  );

  for (const [index, argument] of splitPhpParameterList(
    argumentsSource,
  ).entries()) {
    const namedArgumentMatch =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(argument);
    const argumentName = namedArgumentMatch?.[1]?.toLowerCase() ?? null;
    const value = (namedArgumentMatch?.[2] ?? argument).trim();

    if (argumentName && argumentName !== "related") {
      continue;
    }

    if (!argumentName && index > 0) {
      continue;
    }

    if (/^__CLASS__\b/i.test(value)) {
      return "__CLASS__";
    }

    const classNameMatch = classNameReferencePattern.exec(value);
    const className = classNameMatch?.[1]?.replace(/^\\+/, "") ?? null;

    if (className) {
      return className;
    }

    const variableName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.[1];
    const localClassString = variableName
      ? localClassStringResolver?.(variableName)
      : null;

    if (localClassString) {
      return localClassString;
    }

    const expressionClassString = classStringExpressionResolver?.(value);

    if (expressionClassString) {
      return expressionClassString;
    }

    const stringClassName = phpStringLiteralValue(value)?.replace(/^\\+/, "");

    if (
      stringClassName &&
      /^[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)+$/.test(
        stringClassName,
      )
    ) {
      return stringClassName;
    }
  }

  return null;
}

function phpLocalClassStringResolverForMethodReturnExpression(
  source: string,
  methodName: string,
  returnExpression: string,
): ((variableName: string) => string | null) | undefined {
  const bodyBeforeReturn = phpMethodBodyBeforeReturnExpression(
    source,
    methodName,
    returnExpression,
  );

  if (bodyBeforeReturn === null) {
    return undefined;
  }

  return (variableName: string) =>
    phpLocalClassStringAssignmentBefore(bodyBeforeReturn, variableName);
}

function phpClassStringExpressionResolverForMethodReturnExpression(
  source: string,
  methodName: string,
  returnExpression: string,
  declaringClassName: string,
): ((expression: string) => string | null) {
  const localClassStringResolver =
    phpLocalClassStringResolverForMethodReturnExpression(
      source,
      methodName,
      returnExpression,
    );

  return (expression: string) =>
    phpClassStringExpressionValue(
      source,
      expression,
      declaringClassName,
      localClassStringResolver,
    );
}

function phpLocalClassStringResolverBeforeExpression(
  source: string,
  expression: string,
): ((variableName: string) => string | null) | undefined {
  const expressionOffset = source.indexOf(expression.trim());

  if (expressionOffset < 0) {
    return undefined;
  }

  const sourceBeforeExpression = source.slice(0, expressionOffset);

  return (variableName: string) =>
    phpLocalClassStringAssignmentBefore(sourceBeforeExpression, variableName);
}

function phpClassStringExpressionResolverBeforeExpression(
  source: string,
  expression: string,
  declaringClassName: string,
): ((expression: string) => string | null) {
  const localClassStringResolver = phpLocalClassStringResolverBeforeExpression(
    source,
    expression,
  );

  return (value: string) =>
    phpClassStringExpressionValue(
      source,
      value,
      declaringClassName,
      localClassStringResolver,
    );
}

function phpClassStringExpressionValue(
  source: string,
  expression: string,
  declaringClassName: string,
  localClassStringResolver?: (variableName: string) => string | null,
): string | null {
  const value = expression.trim();
  const variableName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.[1];
  const localClassString = variableName
    ? localClassStringResolver?.(variableName)
    : null;

  if (localClassString) {
    return localClassString;
  }

  const constantMatch =
    /^((?:__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*(?!class\b)([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
      value,
    );
  const ownerName = constantMatch?.[1]?.replace(/^\\+/, "") ?? null;
  const constantName = constantMatch?.[2] ?? null;

  return ownerName && constantName
    ? phpClassStringConstantValueFromSource(
        source,
        declaringClassName,
        ownerName,
        constantName,
      )
    : null;
}

function phpClassStringConstantValueFromSource(
  source: string,
  declaringClassName: string,
  ownerName: string,
  constantName: string,
  visitedConstantNames: Set<string> = new Set(),
): string | null {
  const ownerClassName = phpClassNameForConstantExpression(
    source,
    declaringClassName,
    ownerName,
  );

  if (!ownerClassName) {
    return null;
  }

  const visitKey = `${ownerClassName.toLowerCase()}::${constantName.toLowerCase()}`;

  if (visitedConstantNames.has(visitKey)) {
    return null;
  }

  const body = phpClassBodyForClassName(source, ownerClassName);

  if (!body) {
    return null;
  }

  visitedConstantNames.add(visitKey);

  for (const statement of phpClassConstStatements(body)) {
    for (const item of splitPhpParameterList(statement)) {
      const assignmentMatch =
        /^(?:[\s\S]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(
          item.trim(),
        );
      const name = assignmentMatch?.[1] ?? null;
      const value = assignmentMatch?.[2]?.trim() ?? null;

      if (!name || !value || name.toLowerCase() !== constantName.toLowerCase()) {
        continue;
      }

      return phpClassStringConstantExpressionValue(
        source,
        ownerClassName,
        value,
        visitedConstantNames,
      );
    }
  }

  return null;
}

function phpClassStringConstantExpressionValue(
  source: string,
  ownerClassName: string,
  expression: string,
  visitedConstantNames: Set<string>,
): string | null {
  const value = stripOuterParentheses(expression);

  if (/^__CLASS__$/i.test(value)) {
    return ownerClassName;
  }

  const classNamePattern =
    String.raw`(__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*` +
    String.raw`(?:\\[A-Za-z_][A-Za-z0-9_]*)*)`;
  const classStringMatch = new RegExp(
    String.raw`^` + classNamePattern + String.raw`\s*::\s*class\b`,
    "i",
  ).exec(value);
  const classStringName = classStringMatch?.[1]?.replace(/^\\+/, "") ?? null;

  if (classStringName) {
    return phpClassNameForConstantExpression(source, ownerClassName, classStringName);
  }

  const nestedConstantMatch = new RegExp(
    String.raw`^` +
      classNamePattern +
      String.raw`\s*::\s*(?!class\b)([A-Za-z_][A-Za-z0-9_]*)$`,
    "i",
  ).exec(value);
  const nestedOwnerName = nestedConstantMatch?.[1]?.replace(/^\\+/, "") ?? null;
  const nestedConstantName = nestedConstantMatch?.[2] ?? null;

  if (nestedOwnerName && nestedConstantName) {
    return phpClassStringConstantValueFromSource(
      source,
      ownerClassName,
      nestedOwnerName,
      nestedConstantName,
      visitedConstantNames,
    );
  }

  const stringClassName = phpStringLiteralValue(value)?.replace(/^\\+/, "");

  if (
    stringClassName &&
    /^[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)+$/.test(
      stringClassName,
    )
  ) {
    return stringClassName;
  }

  return null;
}

function phpClassNameForConstantExpression(
  source: string,
  declaringClassName: string,
  className: string,
): string | null {
  const normalized = className.trim().replace(/^\\+/, "").toLowerCase();

  if (
    normalized === "__class__" ||
    normalized === "self" ||
    normalized === "static"
  ) {
    return declaringClassName;
  }

  if (normalized === "parent") {
    const parentClassName = phpExtendsClassName(
      phpClassSourceForClassName(source, declaringClassName) ?? source,
    );

    return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
  }

  return resolvePhpClassName(source, className) ?? className;
}

function phpClassSourceForClassName(
  source: string,
  className: string,
): string | null {
  const range = phpClassRangeForClassName(source, className);

  return range ? source.slice(range.start, range.end) : null;
}

function phpClassBodyForClassName(source: string, className: string): string | null {
  const range = phpClassRangeForClassName(source, className);

  return range ? source.slice(range.bodyStart, range.bodyEnd) : null;
}

function phpClassRangeForClassName(
  source: string,
  className: string,
): { start: number; bodyStart: number; bodyEnd: number; end: number } | null {
  const shortName = className.split("\\").pop();

  if (!shortName) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const pattern = new RegExp(
    String.raw`\b(?:abstract\s+|final\s+)?(?:class|trait|enum)\s+` +
      escapeRegExp(shortName) +
      String.raw`\b[^{]*\{`,
    "g",
  );

  for (const match of masked.matchAll(pattern)) {
    const bodyStart = (match.index ?? 0) + match[0].lastIndexOf("{");
    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    return {
      start: match.index ?? 0,
      bodyStart: bodyStart + 1,
      bodyEnd,
      end: bodyEnd + 1,
    };
  }

  return null;
}

function phpClassConstStatements(classBody: string): string[] {
  const statements: string[] = [];
  const masked = maskPhpStringsAndComments(classBody);
  const pattern =
    /\b(?:(?:public|protected|private|final)\s+)*const\s+([\s\S]*?);/g;

  for (const match of masked.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].indexOf("const") + "const".length;
    const end = (match.index ?? 0) + match[0].length - 1;

    statements.push(classBody.slice(start, end).trim());
  }

  return statements;
}

function phpMethodBodyBeforeReturnExpression(
  source: string,
  methodName: string,
  returnExpression: string,
): string | null {
  const pattern = new RegExp(
    String.raw`\bfunction\s+&?\s*` + escapeRegExp(methodName) + String.raw`\s*\(`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    const body = source.slice(bodyStart + 1, bodyEnd);
    const returnOffset = body.indexOf(returnExpression);

    if (returnOffset >= 0) {
      return body.slice(0, returnOffset);
    }
  }

  return null;
}

function phpLocalClassStringAssignmentBefore(
  source: string,
  variableName: string,
): string | null {
  const classNamePattern =
    String.raw`(__CLASS__|self|static|parent|\\?[A-Za-z_][A-Za-z0-9_]*` +
    String.raw`(?:\\[A-Za-z_][A-Za-z0-9_]*)*)`;
  const assignmentPattern = new RegExp(
    String.raw`\$` +
      escapeRegExp(variableName) +
      String.raw`\s*=\s*` +
      classNamePattern +
      String.raw`\s*::\s*class\b`,
    "g",
  );
  let className: string | null = null;

  for (const match of source.matchAll(assignmentPattern)) {
    className = match[1]?.replace(/^\\+/, "") ?? null;
  }

  return className;
}

function phpLaravelRelationModelTypeFromReturnType(
  returnType: string | null,
): string | null {
  const modelTypes = phpLaravelRelationModelTypesFromReturnType(returnType);

  if (modelTypes.length === 1) {
    return modelTypes[0] ?? null;
  }

  if (
    modelTypes.length > 1 &&
    phpLaravelRelationUsesFirstGenericModel(returnType)
  ) {
    const firstModelTypes =
      phpLaravelFirstGenericRelationModelTypes(returnType);

    return firstModelTypes.length === 1 ? firstModelTypes[0] ?? null : null;
  }

  return null;
}

function phpLaravelRelationModelTypesFromReturnType(
  returnType: string | null,
): string[] {
  if (!isLaravelEloquentRelationReturnType(returnType, true)) {
    return [];
  }

  return phpDeclaredGenericTypeCandidates(returnType ?? "").filter(
    (candidate) => !isGenericLaravelRelationPlaceholder(candidate),
  );
}

function phpLaravelRelationUsesFirstGenericModel(
  returnType: string | null,
): boolean {
  const relationTypeName = phpLaravelEloquentRelationTypeName(returnType);

  return relationTypeName
    ? laravelEloquentFirstGenericRelationTypes.has(relationTypeName)
    : false;
}

function phpLaravelFirstGenericRelationModelTypes(
  returnType: string | null,
): string[] {
  const firstGenericArgument = firstPhpGenericTypeArgument(returnType ?? "");

  if (!firstGenericArgument) {
    return [];
  }

  return phpDeclaredGenericTypeCandidates(
    `Relation<${firstGenericArgument}>`,
  ).filter((candidate) => !isGenericLaravelRelationPlaceholder(candidate));
}

function phpLaravelGenericCarrierMatches(
  source: string,
  typeName: string | null,
  acceptedCarriers: string[],
): boolean {
  const carrierType = phpDeclaredTypeCandidate(typeName ?? "");
  const normalizedCarrierType = carrierType
    ?.trim()
    .replace(/^\\+/, "")
    .toLowerCase();
  const resolvedCarrierType = carrierType
    ? resolvePhpClassName(source, carrierType)
    : null;
  const normalizedResolvedCarrierType = resolvedCarrierType
    ?.trim()
    .replace(/^\\+/, "")
    .toLowerCase();
  const carrierCandidates = new Set(
    [normalizedCarrierType, normalizedResolvedCarrierType].filter(
      (candidate): candidate is string => Boolean(candidate),
    ),
  );

  return acceptedCarriers.some(
    (acceptedCarrier) => carrierCandidates.has(acceptedCarrier),
  );
}

function phpLaravelGenericModelTypeCandidate(typeName: string | null): string | null {
  return phpDeclaredGenericTypeCandidates(typeName ?? "").find(
    (candidate) => !isGenericLaravelRelationPlaceholder(candidate),
  ) ?? null;
}

function phpLaravelRelationTypeForDeclaringClass(
  relationType: string | null,
  declaringClassName: string,
  source: string,
): string | null {
  const normalized = relationType?.trim().replace(/^\\+/, "").toLowerCase();

  if (
    normalized === "__class__" ||
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this"
  ) {
    return declaringClassName;
  }

  if (normalized === "parent") {
    const parentClassName = phpExtendsClassName(source);

    return parentClassName ? resolvePhpClassName(source, parentClassName) : null;
  }

  return relationType;
}

function isLaravelEloquentRelationReturnType(
  returnType: string | null,
  includeCollectionRelations: boolean,
): boolean {
  const shortTypeName = phpLaravelEloquentRelationTypeName(returnType);

  if (!shortTypeName) {
    return false;
  }

  return includeCollectionRelations
    ? laravelEloquentRelationTypes.has(shortTypeName)
    : laravelEloquentSingularRelationTypes.has(shortTypeName);
}

function phpLaravelEloquentRelationTypeName(
  returnType: string | null,
): string | null {
  const typeName = phpDeclaredTypeCandidate(returnType ?? "");
  const normalizedTypeName = (typeName ?? returnType ?? "")
    .trim()
    .replace(/^\?/, "")
    .replace(/^\\+/, "")
    .split("<")[0]
    ?.toLowerCase();

  if (!normalizedTypeName) {
    return null;
  }

  return normalizedTypeName.startsWith(
    "illuminate\\database\\eloquent\\relations\\",
  )
    ? normalizedTypeName.split("\\").pop() ?? normalizedTypeName
    : normalizedTypeName;
}

function isGenericLaravelRelationPlaceholder(typeName: string): boolean {
  const normalized = typeName.trim().replace(/^\\+/, "").toLowerCase();

  return (
    normalized === "self" ||
    normalized === "static" ||
    normalized === "$this" ||
    normalized === "illuminate\\database\\eloquent\\model" ||
    normalized === "model" ||
    /^t[A-Z_]/.test(typeName)
  );
}

function phpCamelCaseToSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function firstPhpGenericTypeArgument(typeName: string): string | null {
  const start = typeName.indexOf("<");

  if (start < 0) {
    return null;
  }

  let depth = 0;

  for (let index = start + 1; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character === ">") {
      if (depth === 0) {
        return typeName.slice(start + 1, index).trim();
      }

      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      return typeName.slice(start + 1, index).trim();
    }
  }

  return null;
}

function topLevelArrayArrowIndex(source: string): number {
  return topLevelArrowIndex(source);
}

function topLevelArrowIndex(source: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "=" && source[index + 1] === ">" && depth === 0) {
      return index;
    }
  }

  return -1;
}

function phpStringLiteralValue(expression: string): string | null {
  const trimmed = expression.trim();
  const match = /^(['"])([\s\S]*)\1$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return (match[2] ?? "").replace(/\\(['"\\])/g, "$1");
}

function phpStringLiteralAtOffset(
  source: string,
  offset: number,
): { value: string; valueOffset: number } | null {
  let quoteOffset = offset;

  while (quoteOffset < source.length && /\s/.test(source[quoteOffset] ?? "")) {
    quoteOffset += 1;
  }

  const quote = source[quoteOffset] ?? "";

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  let value = "";

  for (let index = quoteOffset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      const next = source[index + 1] ?? "";
      value += next || character;
      index += next ? 1 : 0;
      continue;
    }

    if (character === quote) {
      return {
        value,
        valueOffset: quoteOffset + 1,
      };
    }

    value += character;
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPhpAttributeName(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value));
}

function phpDocBlockBefore(source: string, functionOffset: number): string | null {
  const beforeFunction = source.slice(0, functionOffset);
  const docStart = beforeFunction.lastIndexOf("/**");
  const docEnd = beforeFunction.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const betweenDocAndFunction = beforeFunction
    .slice(docEnd + 2)
    .replace(/\b(?:abstract|final|private|protected|public|static)\b/g, " ")
    .trim();

  if (betweenDocAndFunction) {
    return null;
  }

  return beforeFunction.slice(docStart, docEnd + 2);
}

function phpDocReturnTypeFromBlock(docBlock: string | null): string | null {
  return normalizeReturnType(phpDocReturnTypeToken(docBlock));
}

function bestPhpReturnType(
  declaredReturnType: string | null,
  documentedReturnType: string | null,
): string | null {
  if (
    documentedReturnType &&
    hasPhpGenericTypeArguments(documentedReturnType) &&
    !hasPhpGenericTypeArguments(declaredReturnType)
  ) {
    return documentedReturnType;
  }

  return declaredReturnType ?? documentedReturnType;
}

function hasPhpGenericTypeArguments(typeName: string | null): boolean {
  return Boolean(typeName && /<[^>]+>/.test(typeName));
}

function normalizeReturnType(returnType: string | null): string | null {
  const normalized = normalizeWhitespace(returnType ?? "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*&\s*/g, "&");

  return normalized || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePhpExpressionForComparison(value: string): string {
  return value.replace(/\s+/g, "");
}

function splitPhpParameterList(parameters: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(parameters.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(parameters.slice(start).trim());
  return parts.filter(Boolean);
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      if (character === "*" && next === "/") {
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function dedupePhpMembers(members: PhpMethodCompletion[]): PhpMethodCompletion[] {
  const seen = new Set<string>();
  const unique: PhpMethodCompletion[] = [];

  for (const member of members) {
    const key = `${member.kind ?? "method"}:${member.name.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(member);
  }

  return unique;
}

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  const offset = Math.max(0, Math.min(source.length, targetOffset));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}
