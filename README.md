# TI Flow

Aplicação em React, TypeScript e Supabase para a equipe Automações TI.

## Empresas e níveis de administração

- **Administrador do sistema:** cadastra empresas com seu primeiro administrador, alterna entre ambientes e gerencia os acessos de todas as empresas.
- **Administrador da empresa:** gerencia somente a própria equipe e suas atividades. Não pode conceder acesso de administrador do sistema.
- **Gestor e técnico:** mantêm as regras anteriores dentro da própria empresa.
- Atividades, perfis, histórico, auditoria e arquivos privados são isolados por empresa no banco. Reaberturas e vínculos preservam a empresa de origem.
- O login continua no formato `nome.sobrenome`, único em todo o sistema. As senhas e os dois e-mails de acesso seguem as regras existentes.
- A migração preserva os dados atuais na empresa **Automações TI** e promove o administrador inicial a **Administrador do sistema**.
- Use **Empresas → Nova empresa** para informar os dados da empresa e do primeiro administrador. Use **Abrir empresa** ou o seletor lateral para acessar o quadro e a equipe de cada ambiente.

Em novas instalações, aplique `supabase/multi-company.sql` uma única vez depois de `schema.sql` e `storage-and-realtime.sql`. Publique `permissions.ts` junto aos demais arquivos da função. Em produção, aplique a migração versionada antes de atualizar a função e o frontend. Os testes de isolamento usam duas empresas locais, sem enviar e-mails reais.

## Guia público e newsletter

- O guia fica em /blog e a assinatura em /blog/newsletter, na mesma origem do painel. Não exigem login ou outro subdomínio.
- A newsletter usa TI Flow Novidades <news-flow@flow.automacoes.tec.br> e a RESEND_API_KEY já configurada no servidor. O domínio flow.automacoes.tec.br precisa estar verificado no Resend.
- A inscrição tem consentimento explícito e confirmação por e-mail com token de uso único válido por 24 horas. Abrir o link não confirma automaticamente; é preciso clicar no botão da página. Assinar não cria acesso ao painel.
- Cada edição contém cancelamento. Cancelar também remove os próximos envios da fila; uma mensagem já aceita pelo provedor não pode ser recolhida.
- Somente o administrador do sistema acessa Newsletter no menu: escreve assunto e conteúdo, salva rascunho, revisa a prévia e confirma o envio para os assinantes confirmados. As edições não são disparadas automaticamente ao alterar o produto.
- O Cron existente processa as mensagens após os e-mails transacionais. Reservas, limite de tentativas e chave de idempotência protegem contra reenvios; o painel mostra fila, aceitação pelo Resend, falhas e cancelamentos. Aceitação pelo provedor não significa entrega na caixa de entrada.
- As tabelas de assinantes, edições e fila têm RLS e são exclusivas do servidor. O navegador e os administradores das empresas não podem listar assinantes ou chamar suas funções SQL.
- Instalação: aplicar supabase/newsletter.sql depois de multi-company.sql; publicar newsletter.ts junto aos outros arquivos da Edge Function. Em produção, aplicar a migração antes da função e do frontend. Nenhuma alteração DNS adicional é necessária quando o domínio de envio já está verificado.
- O cadastro de usuários mostra a empresa e apenas perfis da empresa. Falhas do servidor aparecem no formulário, preservando os dados para correção. O login permanece único globalmente.

## Publicar na Vercel

1. Importe o repositório `freddmagalhaes/ti-flow` e selecione a branch `main`, usando a raiz do repositório.
2. Use o preset **Vite**, instalação `npm ci`, build `npm run build` e saída `dist`. O arquivo `vercel.json` já declara esses valores e o fallback da SPA.
3. Cadastre nas variáveis de ambiente da Vercel:

   | Variável | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://zhmopjbrujhvuppluaar.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | A chave **publishable** do projeto Supabase, disponível em Settings → API Keys. Nunca use `service_role` ou chave secret. |
   | `VITE_ENABLE_DEMO` | `false` para uso real; `true` somente para explorar dados fictícios durante a ativação. |

4. Faça o deploy. As variáveis `VITE_` são incorporadas na compilação; após alterá-las, faça novo deploy.
5. Depois de definir a URL HTTPS final da Vercel, configure nas **Edge Function Secrets do Supabase**, sem barra final, `APP_URL` e `ALLOWED_ORIGIN` com essa mesma URL. Isso direciona os links dos e-mails e autoriza o frontend a chamar a função. A instalação atual aceita uma única origem; ao trocar para a Vercel, o login pela URL antiga do Sites deixa de ser autorizado.
6. Em Supabase → Authentication → URL Configuration, ajuste **Site URL** e os redirecionamentos permitidos para a URL final.

O backend, o banco, os anexos e o agendamento continuam no Supabase. Os segredos `RESEND_API_KEY`, as chaves privilegiadas e os segredos internos permanecem no Supabase, nunca em variáveis `VITE_` nem no Git. A publicação na Vercel não conclui, por si só, a verificação DNS do Resend ou a criação do primeiro administrador.

Referências: [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite) e [variáveis de ambiente](https://vercel.com/docs/environment-variables).

## Arquivos protegidos

O `.gitignore` exclui ambientes locais, credenciais, chaves privadas, dependências, builds, caches, backups e estado local da Vercel/Supabase. `.env.example` contém apenas nomes de configuração e valores de exemplo. O lockfile e os scripts SQL de instalação devem ser versionados. O Git não remove automaticamente arquivos já rastreados quando uma regra é adicionada: confira `git status` e os arquivos preparados antes de cada commit.

## Estado desta entrega

- Interface, demonstração local, integração Supabase, esquema SQL e funções de servidor implementados.
- A demonstração usa dados fictícios no navegador e **não é o ambiente real da equipe**. Não envia e-mails.
- Projeto exclusivo **ti-flow** criado em **Manager Hours**, em São Paulo (referência: zhmopjbrujhvuppluaar). Tabelas, RLS, Storage privado e Realtime aplicados; nenhum banco existente foi reutilizado. A organização Automações TI foi criada gratuitamente, mas o destino foi alterado para Manager Hours a pedido do usuário.
- O remetente escolhido é `TI Flow <no-reply@flow.automacoes.tec.br>`, via Resend. O domínio de envio é `flow.automacoes.tec.br`; a troca do nome antes de `@` não altera os registros DNS. O domínio foi verificado e os e-mails de acesso foram validados em produção.
- Testes de banco executados em PostgreSQL embarcado (PGlite); não substituem o teste final no Supabase hospedado.

## Executar

Requer Node.js compatível com o Vite 8 e npm.

```powershell
npm ci
npm run dev
npm test
npm run build
```

Sem variáveis `VITE_SUPABASE_*`, a página informa que o ambiente está em preparação e permite explorar a demonstração. Dados fictícios persistem apenas nesse navegador; arquivos de demonstração ficam em IndexedDB. A variável `VITE_ENABLE_DEMO=true` mantém uma demonstração separada disponível durante a ativação. Definir `false` após validar o serviço de e-mail e o primeiro administrador.

## Recursos

- Kanban com arrastar e soltar, suporte a teclado, filtros e ordenação.
- Dashboard, histórico pesquisável e filtros por data de finalização.
- Checklist, comentários, arquivos privados e auditoria.
- Administrador, gestor e técnico; não há perfil de consulta.
- Cards concluídos imutáveis. Reabertura cria outro ID, preserva o original e mantém vínculos permanentes. Uma continuação ativa por cadeia.
- Login `nome.sobrenome`, cadastro por administrador, desativação e alteração de perfil.
- Senha temporária aleatória de 12 caracteres; troca obrigatória. Nova senha alfanumérica de 8 a 12 caracteres, com pelo menos uma letra e um número.
- E-mail de boas-vindas seguido do e-mail da senha aproximadamente 120 segundos depois da aceitação do primeiro envio pelo provedor. Com o processador a cada 30 segundos, o intervalo usual é de 120 a 150 segundos, além do tempo de entrega do provedor.

## Ativar o Supabase

1. O projeto exclusivo **ti-flow** já foi criado em **Manager Hours**, região `sa-east-1`, com custo cotado de US$ 0/mês. Em futuras instalações, confirmar organização e custo antes de criar.
2. Confirmar que o novo projeto está `ACTIVE_HEALTHY` e que não tem tabelas da aplicação.
3. Aplicar `supabase/schema.sql` e depois `supabase/storage-and-realtime.sql` como migrações versionadas. Se usar CLI, descobrir a sintaxe com `supabase --help` e criar os arquivos com `supabase migration new`; não inventar nomes de migração. Conferir o alvo remoto antes de aplicar.
4. Em Auth, desativar cadastro público. Configurar tamanho mínimo 8 e exigência de letras e números. O servidor valida também o máximo de 12 e a ausência de símbolos. Um trigger em `auth.users` bloqueia dados novamente quando a senha muda fora do fluxo validado.
5. Configurar o domínio publicado em Site URL e URLs de redirecionamento do Auth.
6. Definir no ambiente local não versionado `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, copiar os nomes de `.env.example`, recompilar e republicar. Nunca usar chave privilegiada em variáveis `VITE_`.
7. Publicar a função `ti-flow` a partir de `supabase/functions/ti-flow/index.ts`, incluindo `mail.ts`, `policy.ts` e `settings.ts`. Ela usa `verify_jwt=false` porque atende ao login; cada rota protegida valida o token, a sessão ativa, o perfil e a troca de senha obrigatória.

### Configuração protegida no Vault

A instalação atual usa `supabase/vault-runtime.sql`: as chaves internas são geradas no banco e ficam criptografadas no Vault. Somente a função de servidor, autenticada como service_role, consegue obter essa configuração. Variáveis explícitas do ambiente continuam tendo prioridade. A chave `RESEND_API_KEY` deve ser configurada nas Edge Function Secrets; não é armazenada no código. O envio permanece desativado até verificar o domínio e habilitar `ti_flow_delivery_enabled` no Vault.

### Segredos da função

Configure no Supabase, nunca no frontend ou no Git:

| Nome | Uso |
|---|---|
| `APP_URL` | URL HTTPS publicada do TI Flow, sem barra final. |
| `ALLOWED_ORIGIN` | Mesma origem de `APP_URL`. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Transporte de e-mail autenticado. |
| `SMTP_PORT` | `465`, TLS implícito. O Supabase bloqueia saída nas portas 25 e 587. |
| `MAIL_FROM` | `TI Flow <no-reply@flow.automacoes.tec.br>`. Se definida nas Edge Function Secrets, prevalece sobre o valor do Vault. |
| `MAIL_ENCRYPTION_KEY` | 32 bytes aleatórios em Base64, para criptografar o conteúdo temporário da fila. |
| `EMAIL_WORKER_SECRET` | Segredo aleatório exclusivo do processador de e-mails. |
| `EMAIL_DELIVERY_ENABLED` | `false` durante configuração; `true` ao iniciar o teste controlado de ativação. |
| `BOOTSTRAP_SECRET` | Segredo temporário para criar somente o primeiro administrador. Remover após o uso. |
| `RESEND_API_KEY` | Alternativa opcional a SMTP, usando API HTTPS com chave de idempotência. Não exige SMTP quando configurada. |

As variáveis padrão `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo runtime hospedado. Não as incluir no pacote ou frontend.

### Agendamento e primeiro administrador

1. A migração `vault-runtime.sql` já prepara as chaves internas. Em novas instalações, no Vault criar `ti_flow_worker_url` com `https://<project-ref>.supabase.co/functions/v1/ti-flow/worker/send-emails` e `ti_flow_worker_secret` com o mesmo valor de `EMAIL_WORKER_SECRET`.
2. Aplicar `supabase/cron.sql`. O Cron aciona a função a cada 30 segundos. A fila usa reserva de mensagens e no máximo cinco envios simultâneos.
3. Após verificar o domínio no Resend e configurar a chave de envio, habilitar o envio no Vault e executar `scripts/activate-admin.mjs` (entrada por stdin oculta), ou chamar `POST /functions/v1/ti-flow/admin/bootstrap` com `X-Bootstrap-Secret`, passando JSON com `full_name`, `username` e `email` do administrador. O perfil é sempre `system_admin`; a rota recusa novas chamadas quando já há qualquer perfil. Enviar o segredo somente por ferramenta segura, sem gravá-lo em arquivos ou argumentos de shell.
4. O administrador recebe os mesmos dois e-mails e deve trocar a senha no primeiro acesso. Remover `BOOTSTRAP_SECRET` depois de validar a criação.
5. Confirmar os dois envios, intervalo, validade de 24 horas da senha temporária e troca obrigatória. Só então cadastrar os demais integrantes.

Se um envio falhar, a fila tenta novamente até cinco vezes. O segundo e-mail aguarda a aceitação do primeiro. Reenvio manual da senha invalida a anterior. O conteúdo criptografado é removido após envio; falhas e mensagens bloqueadas antigas são limpas pelo processador. SMTP não oferece garantia universal de entrega exatamente uma vez em caso de falha após a aceitação remota; o processador evita repetição de mensagens já confirmadas e preserva a mesma senha nas tentativas automáticas.

## API de servidor

As rotas usam POST sob `/functions/v1/ti-flow/`:

| Rota | Acesso e finalidade |
|---|---|
| `health` | Público; informa conexão e disponibilidade do serviço de e-mail, sem segredos. |
| `auth/login` | Público, com limite de tentativas; recebe usuário e senha. |
| `auth/recover` | Público, com resposta genérica; envia link de recuperação de uso único. |
| `auth/reset` | Token de recuperação válido; altera senha e encerra sessões anteriores. |
| `auth/password` | Sessão válida; valida senha atual, troca senha e encerra sessões anteriores. |
| `admin/bootstrap` | Segredo de ativação e banco sem perfis. |
| `admin/list-users` | Administrador; lista usuários e situação dos e-mails. |
| `admin/create-user` | Administrador; cria conta e programa os dois e-mails. |
| `admin/set-active`, `admin/set-role` | Administrador; gerencia acessos. |
| `admin/resend` | Administrador; gera outra senha temporária. |
| `worker/send-emails` | Segredo exclusivo do processador; nunca chamado pelo frontend. |

Atividades usam a Data API com RLS e controle de versão. Conclusão e reabertura usam `complete_activity` e `reopen_activity`. Eventos de auditoria não permitem escrita pelo cliente.

## Publicação no Sites

O projeto já possui identidade em `.openai/hosting.json`. Reutilizar essa identidade em futuras edições. A hospedagem publica somente `dist/`, não os arquivos de servidor ou os testes. As funções de backend são publicadas no Supabase separadamente.

Executar os testes e a compilação, sincronizar a fonte pelo helper do Sites e publicar o arquivo de implantação gerado. A audiência aprovada permite abrir a página de login por URL; os dados reais exigem autenticação e autorização da aplicação.

## Validação

- 59 testes automatizados, incluindo confirmação, cancelamento e processamento da newsletter: política de senhas, criptografia, permissões, sessão revogada, bloqueio inicial, privilégios, comentários, imutabilidade, reabertura, fila dos e-mails e isolamento entre empresas, inclusive arquivos e administração.
- Compilação TypeScript/Vite e verificação Deno das funções.
- Fluxos pela interface: criação, checklist, comentários, conclusão, consulta e reabertura; movimentação por teclado.
- Dependências de produção: auditoria npm sem vulnerabilidades conhecidas no momento da entrega.
- Ferramentas de desenvolvimento: há aviso transitivo do `picomatch` sem versão corrigida publicada na consulta realizada. Os padrões de compilação e testes são controlados pelo projeto; essas ferramentas não são publicadas como servidor de produção.

O projeto hospedado já passou pela verificação inicial: 6 tabelas com RLS, bucket privado, políticas de arquivos, função publicada e bloqueio das rotas administrativas sem sessão. O advisor retornou somente três avisos informativos de [RLS sem política pública](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), intencionais nas tabelas exclusivas do servidor. Após ativar o provedor, repetir a validação com os três perfis reais, Storage, Realtime, primeiro acesso, recuperação e os dois e-mails. O primeiro acesso do administrador do sistema e os dois e-mails transacionais já foram validados em produção. A validação pública do servidor já confirmou bloqueio de acesso anônimo, administração sem sessão, processador sem segredo, origens externas e configuração privada.
