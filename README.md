# InduSense — Painel Administrativo Next.js

Painel administrativo profissional para o Sistema Inteligente de Monitoramento de Ambientes Industriais.

## Stack
- Next.js 16 + App Router
- React + TypeScript
- Recharts
- Lucide React
- CSS responsivo

## Executar
```bash
npm install
npm run dev
```
Abra `http://localhost:3000`.

## Login demonstrativo
- E-mail: `admin@indusense.com`
- Senha: `123456`

Não existe cadastro público na tela de login. O administrador cria novos usuários dentro de **Usuários**.

## Funcionalidades
- Login e proteção básica da área administrativa
- Dashboard com indicadores
- Monitoramento IoT
- Dispositivos com cadastro
- Sensores e limites
- Alertas com resolução
- Histórico
- Gráficos interativos
- Relatório com impressão/exportação para PDF pelo navegador
- Gerenciamento de usuários
- Configurações
- Layout responsivo

## Próxima etapa para produção
Os dados atuais são simulados no frontend. A arquitetura de páginas/componentes está preparada para substituir os dados simulados por uma API/backend e banco de dados reais, conforme os RF03–RF12 e RNF01–RNF07 do documento de requisitos.
"# InduSense-NextJS" 


## Integração com a API

Crie `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3333/v1
```

O painel usa a API real para autenticação, sessão, salas/dispositivos, sensores, leituras e alertas. O backend precisa estar acessível em `http://localhost:3333` e com CORS liberado para `http://localhost:3000`.

O token JWT é armazenado no `localStorage` apenas para a sessão do navegador e enviado como `Authorization: Bearer <token>`.
# Painel-Indusense
