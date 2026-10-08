 "use client";

import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@indusense.com");
  const [password, setPassword] = useState("123456");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) return setError("Preencha e-mail e senha.");
    setLoading(true);
    try {
      await api.login(email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="brand-mark"><Activity size={25}/><span>Indu<span>Sense</span></span></div>
        <div className="visual-content">
          <span className="eyebrow">INDÚSTRIA 4.0 • IOT • SEGURANÇA</span>
          <h1>Inteligência para monitorar sua indústria em tempo real.</h1>
          <p>Uma central profissional para acompanhar sensores, dispositivos, alertas e indicadores ambientais.</p>
          <div className="visual-stats">
            <div><strong>99,9%</strong><small>Disponibilidade</small></div>
            <div><strong>24/7</strong><small>Monitoramento</small></div>
            <div><strong>IoT</strong><small>Conectado</small></div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand"><Activity size={24}/><b>Indu<span>Sense</span></b></div>
          <div className="login-heading">
            <span className="icon-box"><ShieldCheck size={23}/></span>
            <div><h2>Acessar painel</h2><p>Entre com suas credenciais administrativas.</p></div>
          </div>
          <form onSubmit={submit}>
            <label>E-mail
              <div className="input-wrap"><Mail size={18}/><input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="seu@email.com"/></div>
            </label>
            <label>Senha
              <div className="input-wrap"><LockKeyhole size={18}/><input value={password} onChange={e=>setPassword(e.target.value)} type={show ? "text":"password"} placeholder="••••••••"/><button type="button" className="icon-button" onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
            </label>
            <div className="login-options"><label className="check"><input type="checkbox"/> Lembrar acesso</label><button type="button" className="text-button" onClick={()=>alert("Fluxo de recuperação: contate o administrador do sistema.")}>Esqueci minha senha</button></div>
            {error && <div className="error-box">{error}</div>}
            <button className="primary-btn full" disabled={loading}>{loading ? "Autenticando..." : "Entrar no painel"}</button>
          </form>
          <div className="login-note">Acesso controlado • Não há cadastro público. Novos usuários são criados pelo administrador.</div>
        </div>
      </section>
    </main>
  );
}