// Bia (POPMED) — registra o contato e o retorno da cobrança na planilha
// "[POP] Planilha de cobranças - Automatizada".
//
// Instalação: na planilha, Extensões → Apps Script → colar este código →
// Configurações do projeto → Propriedades do script → BIA_SEGREDO = <segredo>
// → Implantar → Nova implantação → App da Web (Executar como: Eu; Quem pode
// acessar: Qualquer pessoa) → copiar a URL para o secret PLANILHA_ESCRITA_URL
// no Lovable (e o segredo para PLANILHA_ESCRITA_SEGREDO).
//
// Só escreve nas colunas Contato #1..#3, Retorno #1..#3 e Dt Ult Contato, e só
// valores das listas das setinhas. Nunca apaga um contato já preenchido pela
// equipe: o contato da Bia vai no primeiro espaço vazio (#1, #2 ou #3).

var ESPACOS = [["Contato #1", "Retorno #1"], ["Contato #2", "Retorno #2"], ["Contato #3", "Retorno #3"]];
var CONTATOS_OK = ["Contato por Whatsapp", "Contato por telefone"];
var RETORNOS_OK = ["Negociando", "Sem retorno", "Cancelou", "Link de pagamento - Cartão", "Link de pagamento - Pix", "Pagou por cartão", "Pagou por pix"];

function doPost(e) {
  var resposta = function (o) {
    return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  };
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (_) { return resposta({ ok: false, erro: "json" }); }
  var segredo = PropertiesService.getScriptProperties().getProperty("BIA_SEGREDO");
  if (!segredo || b.segredo !== segredo) return resposta({ ok: false, erro: "segredo" });

  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var aba = SpreadsheetApp.getActive().getSheetByName(String(b.aba || ""));
    if (!aba) return resposta({ ok: false, erro: "aba" });
    var dados = aba.getDataRange().getDisplayValues();
    var cab = dados[0].map(function (s) { return String(s).trim(); });
    var col = function (nome) { return cab.indexOf(nome); };

    var cd = String(b.cd || "").trim();
    var cpf = String(b.cpf || "").replace(/\D/g, "");
    var linha = -1;
    for (var i = 1; i < dados.length; i++) {
      var cdLinha = String(dados[i][col("CD_CLIENTE")] || "").trim();
      var cpfLinha = String(dados[i][col("CPF")] || "").replace(/\D/g, "");
      if ((cd && cdLinha === cd) || (!cd && cpf && cpfLinha && ("00000000000" + cpfLinha).slice(-11) === ("00000000000" + cpf).slice(-11))) { linha = i; break; }
    }
    if (linha < 0) return resposta({ ok: false, erro: "cliente" });

    if (b.acao === "contato") {
      if (CONTATOS_OK.indexOf(b.contato) < 0) return resposta({ ok: false, erro: "valor" });
      for (var s = 0; s < ESPACOS.length; s++) {
        var ic = col(ESPACOS[s][0]), ir = col(ESPACOS[s][1]);
        if (ic < 0 || ir < 0) continue;
        if (String(dados[linha][ic]).trim() === "") {
          aba.getRange(linha + 1, ic + 1).setValue(b.contato);
          aba.getRange(linha + 1, ir + 1).setValue("Sem retorno");
          var idt = col("Dt Ult Contato");
          if (idt >= 0) aba.getRange(linha + 1, idt + 1).setValue(new Date());
          return resposta({ ok: true, espaco: s + 1 });
        }
      }
      return resposta({ ok: false, erro: "sem_espaco" });
    }

    if (b.acao === "retorno") {
      var n = Number(b.espaco);
      if (!(n >= 1 && n <= 3) || RETORNOS_OK.indexOf(b.retorno) < 0) return resposta({ ok: false, erro: "valor" });
      var iret = col(ESPACOS[n - 1][1]);
      if (iret < 0) return resposta({ ok: false, erro: "coluna" });
      aba.getRange(linha + 1, iret + 1).setValue(b.retorno);
      return resposta({ ok: true, espaco: n });
    }

    return resposta({ ok: false, erro: "acao" });
  } finally {
    trava.releaseLock();
  }
}
