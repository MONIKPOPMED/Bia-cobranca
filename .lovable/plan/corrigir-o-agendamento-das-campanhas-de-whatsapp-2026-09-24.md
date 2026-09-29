# Corrigir o agendamento das campanhas de WhatsApp

## Implementação
- Trocar somente a autenticação da rota de disparo para o padrão seguro de agendamentos do Lovable.
- Manter intacta a lógica de fila e envio existente.
- Publicar a rota corrigida no domínio atual.
- Recriar o job `whatsapp-campaign-dispatch` para executar a cada cinco minutos com o segredo correto.

## Validação
- Confirmar que o job permanece com frequência de cinco minutos.
- Fazer uma chamada autenticada de validação e confirmar resposta HTTP 200.
- Não editar nem recriar a campanha existente e não enviar campanha manual de teste.

## Detalhes técnicos
- A rota usará `authenticateCronRequest` antes de carregar o executor.
- O job continuará enviando `{}` para o endpoint publicado e passará `LOVABLE_CRON_SECRET` no cabeçalho Bearer.