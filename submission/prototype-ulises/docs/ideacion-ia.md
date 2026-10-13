# Ideación de IA — simulación de la organización completa

> **Decisión final (implementada):** se unificaron el **Escudo contra dark patterns**, la **fricción adaptativa**, el **termómetro de impulso** y el **contrato de Ulises**, con el debate Ángel/Demonio como uno de los niveles de fricción. Ver el [README](../README.md).

> **Aviso:** todo este documento es una **simulación**. Los debates y, sobre todo, el testing de usuarios están razonados por una sola mente que juega todos los papeles. Sirve para llegar con hipótesis afiladas al testing real, **no lo sustituye**.
>
> **Sesgo declarado:** la idea del termómetro de impulso se planteó antes de la ronda. Eso ancla a todos los equipos. Por eso varios equipos “convergen” en ella: no lo toméis como una validación independiente.
>
> **Suposición de contexto:** el repositorio no define el reto. Se asume un contexto fintech/banca/retail con acceso a datos transaccionales.

Etiquetas de confianza: **[Seguro]** con pruebas sólidas · **[Probable]** inferencia fuerte · **[Suposición]** relleno de información que falta.

---

## Fase 1 — Cinco ideas por equipo y debate interno

Criterio principal: **innovación (que no exista ya)**. Criterios secundarios: viabilidad en un hackathon y valor para el usuario.

### SEO / Contenido

| # | Idea | Qué existe ya |
|---|------|---------------|
| 1 | **Mapa de dudas huérfanas:** la IA detecta consultas con mucha demanda y respuestas pobres en la web, y propone *productos*, no artículos, para cubrirlas | Las herramientas de keyword gap existen; convertirlas en una tubería de producto no es habitual [Probable] |
| 2 | **Optimización para agentes de compra:** fichas legibles por agentes LLM que compran en nombre del usuario | La GEO/AEO ya es una disciplina emergente [Seguro] → poco diferencial |
| 3 | **Detector de ansiedad en la consulta:** la misma búsqueda (“préstamo rápido”) recibe una respuesta calmada o una de acción según las señales de urgencia | No se conoce un caso en producción [Suposición] |
| 4 | Contenido que se reescribe según la estacionalidad de la intención | Existe en parte con personalización dinámica |
| 5 | Detección de búsquedas de arrepentimiento (“cómo devolver X”) para alimentar mejoras de producto | Social listening ya lo hace |

**Debate:** la 2 queda descartada por ser ya una tendencia. La 3 conecta con el termómetro, pero el equipo de SEO solo ve la consulta, no al cliente. **Elegida: 1 (Mapa de dudas huérfanas).** La 3 se cede al equipo de Finanzas como señal de entrada.

### Finanzas

| # | Idea | Qué existe ya |
|---|------|---------------|
| 1 | **Termómetro de impulso** (la idea planteada): una puntuación de 0 a 100 antes de pagar, según la transacción, la urgencia, el historial y el contexto | Hay *insights* de gasto a posteriori (Monzo, Revolut) y bloqueos por categoría, como el juego [Seguro]; una puntuación en tiempo real antes del pago no es habitual [Probable] |
| 2 | Negociador automático de facturas | Ya existe (Rocket Money y otros) [Seguro] → descartada |
| 3 | **Recompensa por impulso resistido:** lo que no gastaste se mueve a una meta visible | Qapital tiene reglas parecidas (“guilty pleasure rule”) [Probable] → poco diferencial por sí sola |
| 4 | **Precio en horas de tu vida:** cada importe convertido en horas reales de trabajo según tu nómina | Hay extensiones de navegador que lo hacen [Probable] |
| 5 | Scoring de crédito que premia el autocontrol | Novedosa, pero con riesgo discriminatorio alto |

**Debate:** la 5 recibe el veto anticipado de Riesgo. La 3 y la 4 no se sostienen solas, pero funcionan como *respuesta* cuando el termómetro marca alto. **Elegida: 1, con la 3 y la 4 como acciones del termómetro.**

### Marketing

| # | Idea | Qué existe ya |
|---|------|---------------|
| 1 | **Anti-vendedor honesto:** la IA de la marca te dice cuándo **no** te conviene comprar (ya tienes algo equivalente, te lo vas a devolver, espera a la bajada de precio) | Campañas puntuales como “Don't buy this jacket” de Patagonia [Seguro]; personalizado con IA, no [Probable] |
| 2 | Campañas que se autodestruyen si detectan fatiga en la audiencia | Ya hay control de frecuencia |
| 3 | Panel de usuarios sintéticos para testear mensajes | Ya existe (Synthetic Users y otros) [Seguro] → descartada |
| 4 | **Garantía de arrepentimiento proactiva:** la marca te ofrece la devolución antes de que la pidas cuando predice que no estás usando el producto | No se conoce como estándar [Suposición] |
| 5 | Pausa de cobros ante eventos vitales (despido, nacimiento) | Existe parcialmente como gestión manual |

**Debate:** la 1 sacrifica ventas a corto plazo. El argumento a favor es que reduce las devoluciones, que son un coste real en e-commerce. **Elegidas: 1 y 4.**

### I+D

| # | Idea | Qué existe ya |
|---|------|---------------|
| 1 | **Modelo de arrepentimiento predicho:** probabilidad de devolución, cancelación o queja *antes* de pagar | Hay modelos de devoluciones en el lado del comercio [Probable]; orientado al comprador, no |
| 2 | Biometría conductual (tecleo, scroll) como indicador del estado emocional | La biometría conductual existe para fraude (BioCatch) [Seguro]; usarla para el bienestar es nuevo, pero muy invasivo |
| 3 | **Contrato de Ulises:** en un momento de calma, el usuario fija sus reglas (“si compro de madrugada más de 80 € en moda, espérame 12 h”); en el momento de impulso, la IA las aplica | Hay bloqueos por categoría, pero no reglas autoimpuestas que se activen por estado [Probable] |
| 4 | Modelo en el dispositivo (*on-device*/federado): el banco nunca ve la puntuación de impulso | Técnica conocida, aplicación nueva |
| 5 | Memoria explicable: “¿por qué compré esto?” respondido meses después | Bajo valor |

**Debate:** la 2 queda aparcada por privacidad. La 3 resuelve el mayor problema ético del termómetro: **la decisión la toma el usuario en frío, no el banco en caliente.** **Elegidas: 3 y 1 (el modelo 1 alimenta al termómetro).** La 4 queda como requisito de arquitectura.

### Producto / UX

| # | Idea |
|---|------|
| 1 | **Fricción adaptativa:** fricción cero por defecto; solo aparece cuando el termómetro marca alto |
| 2 | Carrito congelado 24 h con una pregunta posterior |
| 3 | Compañero de compra por voz |
| 4 | Explicación siempre visible de *por qué* sube el termómetro |
| 5 | Interfaz adaptada a la alfabetización financiera |

**Debate:** la 1 y la 4 son la forma correcta de presentar cualquier idea del termómetro. **Elegida: 1, con la 4 como requisito.**

### Legal / Riesgo / Compliance

| # | Idea |
|---|------|
| 1 | **Escudo contra dark patterns:** la IA detecta patrones manipulativos en webs de terceros (falsa escasez, cuentas atrás falsas) y avisa al usuario |
| 2 | Auditor de cláusulas de suscripciones |
| 3 | Consentimiento dinámico y revocable por uso |
| 4 | Detección de clientes vulnerables (requisito de Consumer Duty en Reino Unido [Seguro]) |
| 5 | Caja negra de decisiones para reclamaciones |

**Debate y veto transversal:** el termómetro **solo es legal y defendible si trabaja para el usuario**. Si se usa para que el comercio o el banco aprovechen el impulso, choca con el art. 5 del AI Act de la UE, que prohíbe técnicas manipulativas y la explotación de vulnerabilidades por situación económica o social (aplicable desde febrero de 2025) [Seguro]. Si la puntuación se vende o se usa para *upselling*, la idea muere. **Elegida: 1 (Escudo contra dark patterns).**

---

## Fase 2 — Presentación entre equipos y debate

Finalistas presentados: Mapa de dudas huérfanas (SEO) · Termómetro de impulso (Finanzas) · Anti-vendedor honesto (Marketing) · Garantía proactiva (Marketing) · Contrato de Ulises (I+D) · Fricción adaptativa (Producto) · Escudo contra dark patterns (Legal).

**Puntos clave del debate:**

1. **Fusión obvia:** el termómetro (Finanzas), el Contrato de Ulises (I+D) y la fricción adaptativa (Producto) son la misma idea vista desde tres ángulos: *sensor*, *regla* e *interfaz*. Se fusionan en **“Ulises”**.
2. **El hallazgo que cambia el caso de negocio:** las estafas de pago autorizado (APP fraud) funcionan **fabricando urgencia**. Una víctima de estafa presenta el mismo perfil que una compra impulsiva extrema: beneficiario nuevo, importe redondo, prisa, hora inusual. En Reino Unido el reembolso obligatorio de este fraude (hasta 85.000 £) rige desde octubre de 2024 [Seguro]. **El incentivo del banco queda alineado con el del usuario:** cada estafa frenada es dinero que el banco no reembolsa. Esto resuelve la pregunta de quién paga.
3. **SEO defiende el Mapa de dudas huérfanas**, pero es B2B interno y no se puede testear con usuarios finales. Pasa a la cartera de I+D, fuera del testing.
4. **Finanzas cuestiona al Anti-vendedor:** “¿qué marca lo implantaría?”. Marketing responde con las devoluciones. Pasa al testing, con dudas.

### Fase 2b — Dos ideas nuevas en mitad del debate

**F. “La película de tu préstamo”:** el usuario dice “quiero un coche de 20.000 €” y la IA le narra cómo sería su vida durante los años del préstamo, según sus ingresos y gastos reales.

**G. “Ángel y Demonio”:** dos agentes debaten si debería comprar algo (“reloj de 1.000 €, ¿sí o no?”), uno a favor y otro en contra, y el usuario decide.

**Qué existe ya:**
- **F:** simuladores de préstamo (cuadros de amortización) en todos los bancos [Seguro]; experiencias de *future self*, como el proyecto “Future You” del MIT o la herramienta de envejecimiento facial de Merrill Lynch [Seguro]. Una narración personalizada sobre tus transacciones reales, año a año, no es habitual [Probable].
- **G:** el debate entre agentes es una técnica conocida en investigación de LLM [Seguro], y hay GPTs de “¿debería comprarlo?” [Probable]. El formato de debate visible y anclado a tus datos para una decisión de compra es menos común [Probable], pero **la innovación técnica es baja: el valor está en el formato.**

**Críticas cruzadas:**
- **I+D, sobre F:** “Si la historia la escribe el LLM, se inventará cifras.” → Los números (cuota, TAE, colchón mensual, valor residual del coche) se calculan **en código determinista**. El LLM solo narra. El RAG sirve para recuperar las condiciones del producto, tus patrones de gasto y estadísticas de perfiles similares, **no para hacer cuentas**. [Seguro]
- **Finanzas, sobre F:** 10 años es un plazo atípico para un coche de 20.000 €; lo habitual son 5–8 años [Probable]. Precisamente por eso la historia es potente: en el año 7 sigues pagando un coche que vale una fracción de lo que debes. **Ese momento es el que la narración tiene que hacer sentir.**
- **Legal, sobre G:** si el banco diseña al “demonio” (la voz que dice “cómpralo”), es un vendedor disfrazado. El demonio debe argumentar desde **tus objetivos declarados** (“querías un capricho al año”), no desde los del comercio.
- **Producto, sobre G:** un debate equilibrado produce *falso equilibrio*: el usuario escucha al agente que ya le daba la razón (sesgo de confirmación). → El debate tiene que cerrar con **un dato objetivo que ninguno de los dos agentes puede discutir** (“tras comprarlo, tu colchón baja a 9 días de gastos”).
- **Marketing, sobre G:** es el concepto más *compartible* de toda la ronda: un debate de ángel contra demonio se graba y se comparte. Sirve como canal de adquisición.

**Fusión resultante:** el termómetro (A), el debate (G) y la película (F) son **el mismo producto a tres escalas de tiempo**:

| Escala | Decisión típica | Modo |
|---|---|---|
| Segundos | Compra impulsiva de 60 € | **Termómetro** + regla de Ulises |
| Minutos | Reloj de 1.000 € | **Ángel y Demonio** (se activa si el termómetro marca alto) |
| Años | Coche de 20.000 € con préstamo | **Película del préstamo** |

El termómetro deja de ser solo un freno y pasa a ser el **enrutador**: mide el estado de la decisión y decide qué experiencia ofrecer.

### Fase 2c — Votación entre equipos

**Reglas:** cada equipo reparte 6 puntos, con un máximo de 3 por idea y **sin poder votar sus propias ideas**. Pasan al testing las ideas con ≥2 puntos.

| Idea (equipo de origen) | SEO | Finanzas | Marketing | I+D | Producto | Legal | **Total** |
|---|---|---|---|---|---|---|---|
| Película del préstamo (usuario) | 2 | 2 | 1 | 2 | 1 | 1 | **9** |
| Termómetro de impulso (Finanzas) | 2 | — | 1 | 2 | 1 | 1 | **7** |
| Contrato de Ulises (I+D) | 0 | 2 | 0 | — | 1 | 2 | **5** |
| Ángel y Demonio (usuario) | 1 | 0 | 2 | 0 | 1 | 0 | **4** |
| Escudo contra dark patterns (Legal) | 1 | 1 | 1 | 1 | 0 | — | **4** |
| Arrepentimiento predicho (I+D) | 0 | 1 | 0 | — | 1 | 1 | **3** |
| Anti-vendedor honesto (Marketing) | 0 | 0 | — | 0 | 1 | 1 | **2** |
| Precio en horas de vida (Finanzas) | 0 | — | 1 | 1 | 0 | 0 | **2** |
| Garantía de arrepentimiento proactiva (Marketing) | 0 | 0 | — | 0 | 0 | 0 | 0 |
| Fricción adaptativa (Producto) | 0 | 0 | 0 | 0 | — | 0 | 0 → integrada en el Termómetro |
| Mapa de dudas huérfanas (SEO) | — | 0 | 0 | 0 | 0 | 0 | 0 → cartera interna de I+D |

**Por qué votó así cada equipo:**
- **SEO:** apuesta por la Película y el Termómetro por su potencial de contenido y búsqueda (“¿puedo permitirme un coche?” es una consulta enorme).
- **Finanzas:** vota la Película y el Contrato de Ulises porque reducen la morosidad, lo que tiene un impacto directo en el riesgo de crédito.
- **Marketing:** da sus puntos fuertes a Ángel y Demonio por ser compartible y viral.
- **I+D:** prefiere lo técnicamente diferencial, es decir, el motor del Termómetro y la Película con RAG y cálculo determinista.
- **Producto:** reparte los puntos porque no ve aún un ganador claro desde la experiencia de usuario.
- **Legal:** prioriza las ideas que trabajan claramente para el usuario (Ulises) y penaliza Ángel y Demonio por el riesgo de que el “ángel” acabe siendo un vendedor.

**Alerta de sesgo:** las dos ideas más votadas (Película y Termómetro) vienen directa o indirectamente de quien planteó el reto. En una organización real, esto pide una **votación a ciegas** sin autoría visible.

**Shortlist para el testing de usuarios:**

| Código | Concepto |
|---|---|
| **A** | **Ulises:** termómetro de impulso + reglas que tú fijas en frío + fricción solo cuando hace falta + detección de presión de estafa |
| **B** | **Arrepentimiento predicho:** antes de pagar, “el 40 % de la gente como tú devolvió esto” |
| **C** | **Anti-vendedor honesto** de la marca |
| **D** | **Escudo contra dark patterns** en webs de terceros |
| **E** | **Precio en horas de vida + recompensa por impulso resistido** (versión ligera, sin termómetro) |
| **F** | **Película de tu préstamo** |
| **G** | **Ángel y Demonio** |

---

## Fase 3 — Testing de usuarios (SIMULADO)

> **[Suposición] en su totalidad.** Las reacciones siguientes son hipótesis razonadas sobre perfiles, no datos. Su utilidad es decidir **qué preguntar** en el testing real.

| Perfil | Nivel económico | A | B | C | D | E | F | G | Reacción hipotética clave |
|---|---|---|---|---|---|---|---|---|---|
| Repartidor de apps, 24 | Ingresos variables, ~1.100 €/mes | 4 | 2 | 2 | 3 | 4 | 4 | 3 | “No me digas que no compre, dime si este mes llego.” → **el termómetro debe considerar la liquidez, no solo la moral** |
| Enfermera de turnos de noche, 38 | ~1.800 € | 5 | 3 | 3 | 3 | 3 | 4 | 4 | Compra de madrugada *por rutina*, no por impulso → **riesgo de falsos positivos por la hora** |
| Fontanero autónomo, 45 | Variable, medio | 3 | 2 | 2 | 2 | 3 | 5 | 2 | Va a financiar una furgoneta: la película (F) es justo lo que necesita. Excluir categorías profesionales del termómetro |
| Estudiante, 20 | Sin ingresos propios | 4 | 4 | 3 | 5 | 3 | 2 | 5 | No tiene préstamos; el debate (G) le parece divertido y lo compartiría |
| Directiva de banca, 50 | ~8.000 € | 2 | 3 | 4 | 3 | 1 | 3 | 2 | El impulso no le preocupa; la estafa sí → **valora A solo por el fraude** |
| Jubilado, 72 | Pensión ~1.000 € | 5 | 1 | 2 | 3 | 2 | 2 | 1 | “Si me llaman diciendo que soy del banco, que algo me pare.” Dos bots discutiendo le confunden |
| Cajera, madre soltera, 33 | ~1.200 €, 2 hijos | 4 | 3 | 2 | 3 | 4 | 5 | 3 | Necesita el coche para trabajar (F). Teme que el “demonio” la juzgue → **el tono no puede ser paternalista** |
| Desarrollador freelance, 29 | ~4.000 €, cripto | 3 | 3 | 3 | 4 | 2 | 3 | 4 | Pide que el modelo funcione en el dispositivo; desconfía del banco |
| Agricultor rural, 55 | Medio-bajo, estacional | 3 | 1 | 1 | 2 | 3 | 4 | 1 | Un tractor financiado con ingresos estacionales → F le encaja si respeta la estacionalidad |
| Creadora de contenido, 26 | Muy variable | 4 | 4 | 3 | 4 | 3 | 3 | 5 | Grabaría el debate (G) para su contenido. Quiere un **modo que pueda desactivar** |
| **Media** | | **3,7** | **2,6** | **2,5** | **3,2** | **2,8** | **3,5** | **3,0** | |

**Lectura de la simulación:**
- **A** es la más transversal: puntúa alto en todos los niveles económicos, pero **por razones distintas** (liquidez y protección en ingresos bajos y variables; fraude en ingresos altos y mayores).
- **F** es la que más valor aporta a quien **más arriesga** con una decisión grande: autónomos, rentas bajas que necesitan el coche para trabajar e ingresos estacionales.
- **G** es la más **polarizante**: los menores de 30 la adoran y los mayores de 50 la rechazan. No es el núcleo del producto, sino su **canal de adquisición**.

**Ganadora simulada: “Ulises”, el concepto fusionado (A + G + F).** Un termómetro que mide la decisión y te lleva a la experiencia adecuada: un freno para los impulsos, un debate para los caprichos medianos y una película para las deudas largas. El *pitch*: **un sistema que detecta cuándo alguien —tú mismo, un vendedor o un estafador— te está empujando a pagar, y te da el tiempo y la información justos para decidir en frío.**

Si en el testing real tuvierais que quedaros con **una sola pieza para la demo**, que sea **F**: es la más espectacular en un escenario, la que mejor demuestra el uso de RAG y LLM, y la que tiene un caso de negocio más claro (concesión responsable de préstamos).

---

## Fase 4 — Lo que la idea original pasaba por alto

1. **La urgencia y la necesidad no están en la transacción.** Una transacción dice importe, comercio, hora y beneficiario. La “necesidad” hay que inferirla con indicadores (desvío frente a tu patrón, % del saldo, días hasta la nómina, velocidad de compras). Si el pitch promete leer la necesidad, el jurado lo va a cuestionar. [Seguro]
2. **¿Cuál es la verdad de referencia?** Para entrenar “impulsivo/no impulsivo” hace falta una etiqueta. Indicadores posibles: devolución en ≤14 días, cancelación de suscripción en ≤30 días, descubierto en ≤7 días, autoetiquetado del usuario (“¿te arrepientes?”). Sin esto, el modelo no se puede validar. [Seguro]
3. **Para quién trabaja la puntuación.** Si la ve el comercio, es una herramienta de manipulación (art. 5 del AI Act). Debe ser del usuario y, a ser posible, calcularse en su dispositivo. [Seguro]
4. **Latencia.** Intervenir en la autorización de tarjeta exige responder en milisegundos. Para el MVP es más realista intervenir en la app o en la extensión **antes** de confirmar el pago, o en transferencias, donde hay más margen. [Probable]
5. **Los falsos positivos matan la adopción.** La enfermera del turno de noche abandona la app a la tercera alerta absurda. Hacen falta exclusiones y aprendizaje por usuario. [Probable]

---

## Fase 5 — Propuesta de MVP para el hackathon

**Señales (features) del termómetro:**

| Señal | Ejemplo | Peso inicial |
|---|---|---|
| Desvío frente al patrón de la categoría | 3× tu gasto medio en moda | Alto |
| % del saldo disponible | >30 % del saldo | Alto |
| Días hasta la nómina | Quedan 12 días y el saldo es bajo | Medio |
| Velocidad | 4.ª compra en 60 min | Alto |
| Hora inusual *para ti* (no absoluta) | 03:00 si nunca compras a esa hora | Medio |
| Categoría de comercio | Flash sales, apuestas, cripto, gaming | Medio |
| **Beneficiario nuevo + importe redondo + transferencia inmediata** | 2.000 € a una IBAN nueva | **Muy alto (señal de estafa)** |

**Flujo de la demo:**
1. Onboarding “en frío”: el usuario define 2 o 3 reglas de Ulises.
2. Transacciones sintéticas en streaming → puntuación de 0 a 100.
3. Si se supera el umbral → un LLM explica *por qué* en una frase y aplica la regla del usuario (esperar X horas, mover el importe a una meta, confirmación con una pregunta).
4. Panel: impulsos frenados, dinero protegido, estafas interceptadas.

**Película del préstamo (F): arquitectura mínima:**
1. **Motor determinista (código, no LLM):** proyección mensual del flujo de caja a N años: ingresos (con la variabilidad o estacionalidad detectada) − gastos fijos − cuota del préstamo − gastos derivados del coche (seguro, mantenimiento, combustible) + inflación. Tres escenarios: base, imprevisto (se rompe la lavadora o te quedas 3 meses sin trabajo) y optimista. Salida: colchón de meses, mes de mayor estrés, valor residual del coche frente a la deuda pendiente.
2. **RAG:** recupera (a) tus patrones reales de gasto, (b) las condiciones del producto (TAE, comisiones, amortización anticipada) y (c) estadísticas de perfiles similares.
3. **LLM narrador:** convierte la tabla en capítulos (“Año 3: en agosto, con el seguro y la ITV, ese mes vas justo…”) y **cita cada cifra del motor**, sin generar números propios.
4. **Contrafactual:** la misma película con un coche de 12.000 € o a 5 años, para comparar las dos vidas.

**Ángel y Demonio (G): arquitectura mínima:**
- Dos agentes con el mismo contexto RAG (tus datos y tus objetivos declarados), con instrucciones opuestas y un límite de 3 turnos.
- Un tercer paso, no un agente, muestra **los hechos que ninguno puede discutir** (impacto en el colchón, horas de trabajo, % del objetivo de ahorro).
- La decisión final siempre la toma el usuario; el sistema no da veredicto.

**Métricas para el jurado:** % de arrepentimiento evitado (indicador: devoluciones), falsos positivos por usuario y mes, estafas simuladas detectadas.

---

## Fase 6 — Cómo hacer el testing de usuarios real (mínimo viable)

- **8–12 personas**, cuotas por ingresos (bajo, medio, alto), tipo de ingresos (fijo o variable) y edad (incluir >65).
- **Prueba de concepto con storyboard**, no con la app: 5 tarjetas (A–E), orden aleatorio.
- **Preguntas que importan:**
  - “¿Cuándo fue la última vez que te arrepentiste de un pago? Cuéntamelo.” (historia real antes que la opinión)
  - “Si esto te frenara un pago que *sí* querías hacer, ¿qué harías?” (tolerancia al falso positivo)
  - “¿Quién te gustaría que viera esta puntuación? ¿Y quién no?” (confianza)
  - “¿Pagarías por ello o lo esperarías de tu banco?” (modelo de negocio)
- **Hipótesis a validar o refutar:** *el gancho para los perfiles de ingresos altos y los mayores es el fraude, no el autocontrol.*
