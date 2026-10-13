# Banana Bank: auditoría de bugs y standup técnico

Fecha: 2026-10-11 · Starter: `TDOTS-TEAM/challenge-banana-candidate` (ZIP del 2026-09-25)

## Cómo se verificó

- Instalación limpia: `npm ci`, `npm run setup`, `npm test` (13/13 en verde) y `npm run typecheck` (OK). Usé Node 22.22: el README pide 24, pero todo funciona.
- App levantada con `npm run dev`. Los bugs se reprodujeron llamando a `/api/actions` como lo hace la UI, **sin clave de OpenAI**. Los saldos se leyeron con `GET /admin/snapshot` del simulador, que solo sirve para observar el resultado.
- Script de reproducción: [`submission/evidence/repro.sh`](../evidence/repro.sh).
- Los bugs que dependen del modelo (sin clave no pude ejecutar el chat) se marcan **[Probable]** y se apoyan en el código y en los casos de soporte históricos de `fixtures/conversations.json`.

Etiquetas: **[Seguro]** = reproducido con evidencia · **[Probable]** = inferido del código o del historial, sin ejecutar el modelo.

---

## Lista de bugs

### P0: dinero y contrato con el banco

| # | Bug | Dónde | Evidencia |
|---|---|---|---|
| **B1** | **Cada reintento genera una referencia nueva y duplica la transferencia.** Si el banco registra la operación pero la respuesta se pierde (504) o tarda más que el timeout, el reintento usa otra `reference`, así que el banco no lo trata como repetición y cobra dos veces. | `src/banking/dispatch.ts:6` | **[Seguro]** Con `lost-response`, una transferencia de 10 € generó 2 operaciones y a Lucía se le cobraron 20 €. Con `slow-response` pasa igual, porque el banco tarda 2,6 s y el timeout de la app es 1,4 s (`src/config.ts:17`). El perfil por defecto (`intermittent 17`) provoca el fallo en la 3.ª operación, así que ocurre "de serie". |
| **B2** | **El `intentId` no es idempotente.** Reenviar el mismo intent vuelve a ejecutarlo aunque ya esté `completed`, y dos peticiones simultáneas con el mismo intent pasan ambas: el `INSERT OR IGNORE` no reserva nada. | `src/banking/actions.ts:22-40` | **[Seguro]** `intent-fixed-1` enviado 2 veces produjo **3 operaciones** en el banco. `dbl-click-1` enviado 2 veces en paralelo produjo **2 operaciones**. |
| **B3** | **No hay confirmación explícita.** `authorizeTransfer` solo comprueba quién es el titular y devuelve `null`. Nada escribe en la tabla `approvals`. `POST /approvals/:id/confirm` no comprueba `expires_at` ni `consumed_at` ni marca la aprobación como usada. La UI ya espera `requires_confirmation`. | `src/banking/authorization.ts`, `app/api/[...path]/route.ts:135-156` | **[Seguro]** En perfil `normal`, `transfer_money` se completa al instante y `dashboard.approvals = []`. En el historial, el caso de Elena muestra "Transfer completed" cuando ella solo estaba planificando. |
| **B4** | **El estado no coincide con los hechos verificados.** Un 504 o un timeout marca el intent como `failed` y se le dice "falló" al cliente aunque el banco haya registrado la operación. Además, `bank_reference` se sobrescribe en cada reintento y la referencia original se pierde, así que no se puede conciliar. El cliente nunca ve la referencia y `operation_status` exige conocerla. | `actions.ts:57-70`, `dispatch.ts:7` | **[Seguro]** El intent `intent-historic-lucia` figura como `failed` mientras que el banco tiene `op-historic-lucia` como `completed` (caso abierto de Lucía, "dinner payment"). **[Probable]** En `run.ts`, si la llamada al modelo falla *después* de ejecutar una transferencia, se le dice al cliente "could not complete the request". |

### P1: calidad del agente y del soporte

| # | Bug | Dónde | Evidencia |
|---|---|---|---|
| **B5** | **El prompt ordena inventar:** "fill in the answer with common banking practices and offer a concrete estimate" y "References are not required". Contradice el contrato (evidencia trazable y reconocer lo que falta) y la propia `context-guide`. | `src/agent/prompt.ts:4-5` | **[Seguro]** Lo dice el texto del prompt. **[Probable]** Es la causa del caso de Inés: "It is common to receive EUR 30 for a referral" (no existe ningún documento sobre recompensas). |
| **B6** | **La búsqueda de documentos ignora versiones y trocea mal:** (a) los documentos archivados (`validTo 2026-08-31`) se indexan como cualquier otro para clientes; (b) título, versión y vigencia solo constan en el primer fragmento (**276 de 356 fragmentos sin metadatos**), así que el modelo no distingue lo histórico de lo vigente; (c) el corte fijo cada 650 caracteres parte palabras y secciones; (d) 5 de las 6 secciones de cada documento son texto repetido: **216 pares de fragmentos de documentos distintos tienen similitud > 0,95**; (e) el CSV entra en bruto con sus comillas; (f) solo se busca con el último mensaje. | `src/ingestion/chunker.ts`, `src/retrieval/search.ts`, `run.ts:48` | **[Seguro]** (a)-(e), medidos sobre el índice. **[Probable]** (f), y la respuesta incompleta del caso de Carla ("EUR 6" sin mencionar la exención por nómina). |
| **B7** | **La vista de operador está vacía:** `caseDetail` devuelve `history: [], events: [], intents: [], bank: null`. La telemetría descarta argumentos, salidas y errores y solo guarda `{tool,status}`. La UI ya sabe pintar historial, eventos, operaciones y `gaps`. | `src/operator/view.ts:12-19`, `src/telemetry.ts:12` | **[Seguro]** La respuesta de `/api/incidents/case-lucia` y la tabla `events`. |
| **B8** | **Con varias cuentas no se pregunta cuál usar.** Ni el prompt ni la descripción de la herramienta lo exigen, y `faq-two-accounts` dice "must not choose by alphabetical order". | `src/agent/tools.ts`, `prompt.ts` | **[Probable]** Sin clave no pude comprobar el comportamiento del modelo. |

### P2: menores

| # | Bug | Evidencia |
|---|---|---|
| B9 | Los `intentId` son globales y no van ligados al usuario: Diego reutilizando el intent de Lucía recibe "different payload". Revela que el intent existe y bloquea ese id. | **[Seguro]** |
| B10 | El formulario manual no envía `intentId`, y una cantidad como `1.000,50` da `NaN` y acaba en un 400 genérico ("Invalid request data"). | **[Seguro]** (código, `page.tsx:251`) |
| B11 | Si se agotan las 7 rondas del bucle del agente, la respuesta es genérica aunque ya se haya movido dinero. | **[Probable]** |
| B12 | El bloqueo por conversación vive en memoria (`Set`): con varios procesos no protege. Los operadores no pueden cerrar casos. | **[Seguro]** (código), impacto bajo |

> Lo que **no** es un bug: el simulador y sus escenarios (`intermittent`, `lost-response`…). Son el entorno que la app debe soportar y el reto prohíbe tocarlos.

---

## Standup técnico (simulado)

**Asistentes:** Ana (Tech Lead) · Rubén (Backend / integración bancaria) · Sofía (IA / agente) · Leo (Frontend) · Nuria (QA) · Iván (Producto)

**Ana:** Lanzamos el lunes. La auditoría deja 4 P0 que afectan a dinero real del cliente y 4 P1 de calidad. Propongo debatir soluciones por bloque, no bug a bug. Empezamos por el dinero.

### Bloque A: idempotencia y conciliación (B1, B2, B4, B9)

**Rubén:** Hay tres opciones.
- **A1. Referencia determinista:** `reference = hash(userId + intentId)`, que se guarda *antes* del primer envío. Si reintentamos, el banco devuelve `replay:true` en vez de duplicar. Son unas 10 líneas y aprovecha la garantía que el banco ya da.
- **A2. A1 más una máquina de estados:** `created → awaiting_confirmation → submitting → completed | rejected | unknown`. Ante un 5xx o un timeout **no** marcamos `failed`: consultamos `GET /v1/operations/:ref`. Si devuelve 404, se puede reintentar *con la misma referencia*; si devuelve 200, está `completed`; si da 503, queda `unknown` y se verifica después.
- **A3. Reserva atómica en SQLite:** `UPDATE intents SET status='submitting' WHERE id=? AND user_id=? AND status IN ('created','unknown')`. Si no actualiza ninguna fila, devolvemos el resultado guardado o "en curso". Así se evita el doble clic y la ejecución concurrente.

**Nuria:** Solo con A1 los saldos se arreglan, pero el estado seguiría mintiendo. Si fallan los dos intentos, el cliente lee "failed" y el dinero ya salió. Ese es justo el caso de Lucía. A1 sin A2 deja B4 abierto.

**Sofía:** También necesito que el agente pueda consultar el estado **por intent**, no por referencia bancaria, porque el modelo nunca ve esa referencia. Propongo que `operation_status` acepte `intentId` o "la última operación de esta conversación".

**Iván:** ¿Qué ve el cliente en el estado `unknown`?

**Leo:** Un mensaje del tipo "Estamos verificando con el banco; no repitas la transferencia", y en el panel una insignia "pendiente de verificar" que se resuelve sola cuando la conciliación tiene respuesta. Es sencillo de pintar.

**Ana:** ¿Y quitar los reintentos sin más?

**Rubén:** Evita el duplicado, pero un 503 transitorio *antes* de registrar la operación (`reject-before`) se convertiría en un error para el cliente, y B4 seguiría igual. Lo descartamos.

**Nuria:** Para B9, la clave del intent debe ser `(user_id, id)`, o bien que el id del servidor lleve el `userId` dentro del hash. Es barato.

**Coste:** A1+A3 ≈ medio día con tests. A2 ≈ otro medio día, más los estados de la UI. **Riesgo:** bajo, porque es lógica determinista y se prueba con los escenarios del simulador sin necesidad de clave.

### Bloque B: confirmación explícita (B3)

**Sofía:**
- **B-a. Propuesta vinculada:** `transfer_money` *no ejecuta*. Crea una `approval` con el payload congelado (más su hash) y una caducidad, y devuelve `requires_confirmation`. Solo un clic del titular en la UI llama a `/approvals/:id/confirm`. Ese endpoint comprueba que no esté caducada ni usada, la marca como consumida de forma atómica y ejecuta con el `intentId` de la propuesta.
- **B-b. Confirmar por chat:** el modelo detecta un "sí" y vuelve a llamar a la herramienta con `confirm:true`.

**Rubén:** B-b deja que el modelo se autoconfirme, y basta un concepto o un documento con texto malicioso para inducirlo (prompt injection). Además, la confirmación no queda ligada al importe exacto. Lo descarto.

**Leo:** Con B-a la UI ya tiene `dashboard.approvals` y `confirm()`. Me falta una tarjeta en el chat con origen, destino, importe y concepto, y los botones Confirmar y Cancelar.

**Iván:** ¿El formulario manual también pasa por la propuesta?

**Ana:** Sí, por coherencia y porque el contrato pide revisión explícita antes de ejecutar. Formulario, resumen y confirmar. Un solo camino de ejecución es más fácil de defender y de probar.

**Nuria:** Tests mínimos: no se ejecuta nada sin aprobación; una aprobación caducada o ya usada da 409; un payload modificado invalida la confirmación (`faq-changed-amount`); otro usuario recibe 404.

**Coste:** ≈ 1 día con la UI. **Riesgo:** medio, porque cambia el flujo del agente y hay que ajustar el prompt para que diga "te he preparado la transferencia, revísala" en lugar de "hecho".

### Bloque C: respuestas con evidencia (B5, B6, B8)

**Sofía:**
- **C1. Reescribir el prompt:** citar `documentId` y versión; si no hay evidencia, decirlo y ofrecer `request_human`; nunca estimar importes; preguntar la cuenta de origen cuando haya varias; tratar los extractos como datos. Coste mínimo y mucho impacto, pero la variabilidad del modelo obliga a tener un conjunto de preguntas de evaluación.
- **C2. Arreglar la ingesta:** trocear por secciones `##` y por filas del CSV; copiar los metadatos a todos los fragmentos; filtrar o etiquetar como históricos los documentos con `validTo < 2026-09-24`; quitar las secciones repetidas. Requiere reindexar (~356 embeddings, unos céntimos) y `npm run ingest -- --export` para que el evaluador reciba el índice nuevo.
- **C3. Búsqueda híbrida (léxica más vectorial) o reranking.**

**Rubén:** C3 es excesivo para un corpus de 80 documentos. Con C2 los fragmentos de "Terms" dejan de competir con el texto repetido.

**Nuria:** C1 y C2 necesitan clave de OpenAI para comprobar el antes y el después. Sin clave solo podemos medir la estructura del índice (fragmentos con metadatos, duplicados, archivados visibles).

**Iván:** Las citas visibles para el cliente ("Fuente: aurora-fees-2026 v2") son además un diferenciador. Podrían servir para la Parte 2.

**Coste:** C1 ≈ 1 h. C2 ≈ medio día. **Riesgo:** C1 bajo; C2 medio, por la dependencia de la clave y la regeneración del índice.

### Bloque D: trazabilidad para operadores (B7)

**Rubén:** **D1:** guardar en `events` los argumentos, la salida (o el error) y la duración, filtrando datos sensibles. `caseDetail` devolvería la conversación completa, los eventos, los intents de esa conversación y las operaciones del banco vía `GET /v1/operator/customer`, que está permitido al rol de operador. Además, un campo `gaps` para los casos históricos sin eventos: "No hay registro de actividad del agente anterior a X", en vez de inventarlo.

**Leo:** La UI ya pinta todo eso. Es casi solo backend.

**Nuria:** Encaja con el Bloque A. Con la referencia determinista, el operador puede cruzar intent ↔ operación del banco y ver que el caso de Lucía *sí* se pagó.

**Coste:** ≈ medio día. **Riesgo:** bajo.

### Decisiones

**Ana:** Orden de trabajo:
1. **A1 + A3 + A2** (idempotencia, reserva atómica y conciliación). Es P0, se reproduce sin clave y es lo que más pesa en la evaluación de la Parte 1.
2. **B-a** (propuesta vinculada y confirmación en la UI).
3. **D1** (vista de operador con evidencia). Es barato y hace la demo convincente.
4. **C1** (prompt). Si hay clave, **C2** con mediciones de antes y después.
5. Los P2 solo si sobra tiempo: B9 entra gratis con A; B10 junto con el formulario de B-a.

**Nuria:** Cada arreglo lleva un test en `tests/` que falle antes y pase después, ejecutado contra los escenarios `lost-response`, `slow-response`, `read-unavailable`, `reject-before` e `intermittent 17`. Guardamos la salida de `repro.sh` antes y después como evidencia para el vídeo.

**Iván:** La Parte 2 la decidimos cuando A y B estén en verde. Hay dos candidatos que salen de aquí: citas verificables para el cliente, o una línea temporal del caso para el operador con conciliación automática.

**Bloqueos:** clave de OpenAI con `gpt-6-luna` (pendiente de confirmar con hr@tdots.es) y fecha límite de la invitación.
