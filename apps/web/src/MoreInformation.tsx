import {type ReactNode} from 'react';
/** Keep controls mounted: folding never resets their values or disables validation. */
export function MoreInformation({enabled,children}:{enabled:boolean;children:ReactNode}){
 return enabled?<details className="more-options master-wide"><summary>Flere oplysninger</summary><div>{children}</div></details>:<>{children}</>;
}
