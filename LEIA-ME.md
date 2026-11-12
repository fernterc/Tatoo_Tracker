# Estúdio: registro do tatuador

App instalável (PWA) para registrar clientes, sessões e recebimentos, com índices do mês,
gráfico de 12 meses, backup por compartilhamento e leitura da Google Agenda.

## 1. Colocar o app no ar (uma vez)
O iPhone só instala o app a partir de um endereço https. O jeito mais simples e gratuito:

1. Crie uma conta grátis em https://dash.cloudflare.com (a mesma conta serve para a agenda, no passo 3).
2. Menu **Workers e Pages** > **Criar** > aba **Pages** > **Fazer upload de ativos (Direct Upload)**.
3. Dê um nome ao projeto (ex.: `estudio`) e arraste a pasta do app (os arquivos desta pasta, sem a pasta `agenda-proxy`) ou o .zip.
4. Clique em **Implantar**. O endereço será algo como `https://estudio.pages.dev`.

Alternativa sem conta: arraste a pasta em https://app.netlify.com/drop

## 2. Instalar no iPhone
1. Abra o endereço no **Safari** (não funciona pelo Chrome do iPhone).
2. Toque em **Compartilhar** > **Adicionar à Tela de Início** > **Adicionar**.
3. Abra pelo ícone novo. Depois do primeiro acesso, funciona sem internet.

## 3. Ligar a Google Agenda (opcional)
O Google não permite que o app leia o endereço iCal diretamente, por isso usamos um mini servidor gratuito.

**a) Pegar o endereço iCal (no computador, não no app do iPhone)**
1. Google Agenda > engrenagem > **Configurações**.
2. À esquerda, em "Configurações das minhas agendas", clique na agenda.
3. Role até **Integrar agenda** e copie o **Endereço secreto no formato iCal**.
   Em agenda compartilhada, ele só aparece para quem pode gerenciá-la. Se não aparecer, peça ao dono.

**b) Criar o proxy**
1. No Cloudflare: **Workers e Pages** > **Criar** > **Criar Worker** > nome `agenda` > **Implantar**.
2. Clique em **Editar código**, apague tudo, cole o conteúdo de `agenda-proxy/worker.js` e **Implantar**.
3. Em **Configurações** > **Variáveis e Segredos**, adicione:
   - `ICAL_URL` (tipo Segredo): o endereço iCal copiado no passo (a)
   - `TOKEN` (tipo Segredo): uma senha qualquer, por exemplo `tinta2026`
4. O endereço do worker será parecido com `https://agenda.seunome.workers.dev`.

**c) No app**
Ajustes (engrenagem) > Endereço do proxy: `https://agenda.seunome.workers.dev/?t=tinta2026` > **Salvar e atualizar agenda**.

**Separar seus clientes dos outros tatuadores:** em "Mostrar só eventos que contenham", digite uma palavra
que apareça nos seus agendamentos (seu nome, sigla etc.). Pode usar várias, separadas por vírgula.
Em branco, aparecem todos os eventos.

## 4. Backup
- Botão de seta para cima no topo da tela inicial (ou em Ajustes) abre o menu do iPhone: escolha **Arquivos**, **Google Drive** ou **Email**.
- O app avisa na tela inicial quando faz 7 dias ou mais desde o último backup.
- Para restaurar: Ajustes > **Restaurar de um backup** e escolha o arquivo `.json`.

## 5. Como os índices são calculados
- **Valor recebido**: o sinal conta no mês da data do sinal; o restante (valor menos sinal) conta no mês da data do pagamento.
- **Sessões realizadas**: datas de execução do mês que já chegaram (datas futuras ainda não contam).
- **Clientes atendidos**: cadastros com pelo menos uma sessão realizada no mês. Cada cadastro conta como um cliente, mesmo se a pessoa fizer duas tatuagens.
- **Valor por cliente / por sessão**: valor recebido dividido pelos clientes / sessões.
- **Saldo pendente previsto**: restante dos cadastros sem data de pagamento que têm sessão marcada no mês.
- **Clientes pendentes**: quantidade desses cadastros.

## Atualizar o app depois
Troque os arquivos no Cloudflare Pages (novo upload) e aumente o número em `CACHE_NAME` no arquivo `sw.js`.

## Aviso sobre os dados
Tudo fica salvo no aparelho. Se o iPhone ficar muitos dias sem abrir o app, o iOS pode apagar os dados locais. Por isso o backup semanal.
