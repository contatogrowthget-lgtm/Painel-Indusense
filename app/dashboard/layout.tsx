import AlertWatcher from "../components/AlertWatcher";

/** Tudo dentro de /dashboard ganha o aviso grande de alertas. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AlertWatcher />
    </>
  );
}
