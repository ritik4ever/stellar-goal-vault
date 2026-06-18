import React, { Suspense, ComponentType, lazy } from "react";
const Fallback = () => <div style={{ padding: 20, background: "#1e293b", borderRadius: 8, height: 200 }} />;
export function LazyPanel({ component, ...props }: { component: () => Promise<{ default: ComponentType<any> }> } & any) {
  const LazyComp = lazy(component);
  return <Suspense fallback={<Fallback />}><LazyComp {...props} /></Suspense>;
}
