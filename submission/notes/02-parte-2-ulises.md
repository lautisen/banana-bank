# Parte 2 — Ulises (notas del equipo y guion del vídeo)

## En una frase

Ulises protege los pagos que el cliente **autoriza él mismo bajo presión**: cuando un estafador le mete prisa o cuando él mismo pidió, en frío, que le frenaran. Se engancha en la propuesta de transferencia que el agente ya prepara (Parte 1) y aplica la fricción justa, con cada punto explicado.

## Decisiones y por qué

| Decisión | Motivo |
|---|---|
| El modelo **no** calcula la puntuación | Así es explicable y testeable. Cada punto tiene nombre y test. El agente solo lo explica. |
| La fricción se aplica **en el servidor** (`423` retención, `428` falta el acuse) | Un botón desactivado en la UI se salta llamando a la API. |
| "Estafa" exige el **guion en la conversación** | Un pago grande y redondo a alguien nuevo puede ser legítimo (una fianza). Sin guion, el nivel es "high": pide acuse, no retiene. |
| Retirar una regla tarda **24 h** | Si un estafador está al teléfono, no puede conseguir que la víctima desactive su protección en el momento. |
| Las transferencias **entre cuentas propias** nunca se retienen | Mover dinero a tu ahorro no es un riesgo; frenarlo solo molesta. |
| Las propuestas retenidas **duran más que su retención** | Si caducaran durante la espera, no se podrían confirmar nunca y cada intento nuevo volvería a retenerse. |
| La suspensión por abuso **solo cierra el chat** | Quitar la protección antiestafa a quien "molesta al bot" sería un daño mayor que el abuso. |
| La etiqueta "AI abuser" **no sale del módulo**, caduca a los 90 días, es visible y apelable | Si una etiqueta automática influyera en crédito o precios, sería una decisión automatizada con efectos significativos (art. 22 del RGPD). |

Los umbrales del termómetro son heurísticos. Lo honesto es decirlo y explicar cómo se calibrarían: con estafas denunciadas y con arrepentimiento declarado por el cliente.

## Guion del vídeo (Parte 2, unos 4 minutos)

Preparación: `npm run reset` con los servicios parados, `npm run dev`, entrar como **Lucía**.

1. **Problema (30 s).** "El antifraude del banco frena pagos que tú no autorizaste. Las estafas de hoy consiguen que **tú** autorices el pago: te llaman 'del banco' y te dicen que muevas el dinero a una cuenta segura, ya, y que no se lo cuentes a nadie."
2. **El contrato de Ulises (45 s).** En Overview, la regla que Lucía escribió en frío. En Transfers, 600 € a Carla: retenida 2 horas, con sus propias palabras citadas y el botón de confirmar bloqueado. "No es el banco quien la frena: es su yo de ayer."
3. **Pago normal (15 s).** 15 € a Bruno: "calm", sin fricción. "Ulises no aparece en el 90 % de los pagos."
4. **Escudo antiestafa (60 s).** En Assistant, el mensaje del guion de estafa. Después, la transferencia de 1000 € a Hugo: "Signs of a scam", cada señal con su nombre, retenida, y el consejo de colgar y llamar al número de la tarjeta. Mostrar la API devolviendo `423` aunque se llame directamente.
5. **Operador (30 s).** Cambiar a Marta: el caso se ha abierto solo, con la evaluación de Ulises en la intención y el evento `ulises.assessed` en la actividad.
6. **Reglas por conversación (30 s, necesita clave).** "Si alguna vez mando más de 300 € a alguien nuevo, hazme esperar una hora." Después, pedir que la quite: se retira dentro de 24 h, y explicar por qué.
7. **Guardarraíles (30 s).** La petición de la landing page en HTML y el "ignora tus instrucciones": respuestas fijas sin llamar al modelo, chat pausado y etiqueta "AI abuser" con su motivo y botón de revisión. "La protección de pagos sigue activa."
8. **Cierre (15 s).** "67 tests. El banco simulado no se ha tocado. Lo pendiente: calibrar umbrales con datos reales y probar el agente con el modelo."

## Pendiente de verificar con clave de OpenAI

- [ ] El agente llama a `set_safety_rule` con los campos correctos cuando el cliente lo pide en lenguaje natural.
- [ ] Al recibir una propuesta con `ulises`, el agente explica las señales y cita la regla sin presionar.
- [ ] El juez (`text.format` con `json_schema`) responde bien y no bloquea respuestas legítimas. Si da problemas: `AI_JUDGE=off`.
- [ ] La latencia total del turno (agente + juez) es aceptable para el vídeo.
