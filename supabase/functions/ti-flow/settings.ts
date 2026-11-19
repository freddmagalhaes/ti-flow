let runtimeValues:Record<string,string>={};
export function setting(name:string):string|undefined {return Deno.env.get(name)??runtimeValues[name];}
export function configureRuntime(values:Record<string,string>) {runtimeValues={...values};}
