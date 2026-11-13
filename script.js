// script.js - Lógica del chat del "Agente de viaje"

// ---------- Constantes ----------
const LIMITE_CARACTERES = 500;
const TIEMPO_LIMITE_MS = 30000;      // 30 segundos de espera máxima
const PAUSA_ENTRE_ENVIOS_MS = 1500;  // 1,5 segundos entre envíos
const CLAVE_SESION = "sessionId";
const AVISO_SIN_URL = "Falta pegar la URL de tu webhook en config.js";

// ---------- Elementos del DOM ----------
const zonaDeChat = document.getElementById("zona-de-chat");
const listaMensajes = document.getElementById("mensajes");
const indicadorEstado = document.getElementById("estado");
const zonaDeEscritura = document.getElementById("zona-de-escritura");
const campoMensaje = document.getElementById("campo-mensaje");
const contador = document.getElementById("contador");
const botonEnviar = document.getElementById("boton-enviar");

// ---------- Estado de la app ----------
let sessionIdEnMemoria = null; // se usa si localStorage no está disponible
let enviando = false;

// ---------- sessionId ----------

// Crea un identificador único
function crearSessionId() {
  if (window.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "sesion-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

// Lo busca en localStorage; si no existe lo crea y lo guarda
function obtenerSessionId() {
  try {
    let id = localStorage.getItem(CLAVE_SESION);
    if (!id) {
      id = crearSessionId();
      localStorage.setItem(CLAVE_SESION, id);
    }
    return id;
  } catch (error) {
    // Sin almacenamiento: usamos una variable en memoria
    if (!sessionIdEnMemoria) sessionIdEnMemoria = crearSessionId();
    return sessionIdEnMemoria;
  }
}

// Se genera UNA sola vez al iniciar y se reutiliza en todos los envíos
const sessionId = obtenerSessionId();

// ---------- Interfaz ----------

// Agrega una burbuja al chat (siempre con textContent)
function agregarBurbuja(texto, tipo) {
  const burbuja = document.createElement("div");
  burbuja.className = "burbuja burbuja-" + tipo; // usuario | agente | error
  burbuja.textContent = texto;
  listaMensajes.appendChild(burbuja);
  listaMensajes.scrollTop = listaMensajes.scrollHeight;
}

// Estados: "cargando", "exito" o "error"
function cambiarEstado(estado) {
  zonaDeChat.dataset.estado = estado;
  const cargando = estado === "cargando";
  indicadorEstado.hidden = !cargando;
  indicadorEstado.textContent = cargando ? "El agente está escribiendo…" : "";
}

function bloquearControles(bloquear) {
  campoMensaje.disabled = bloquear;
  botonEnviar.disabled = bloquear;
}

function liberarControles() {
  enviando = false;
  bloquearControles(false);
  campoMensaje.focus();
}

function actualizarContador() {
  contador.textContent = campoMensaje.value.length + " / " + LIMITE_CARACTERES;
}

// ---------- Webhook ----------

// ¿Falta configurar la URL?
function urlSinConfigurar() {
  if (typeof WEBHOOK_URL === "undefined") return true;
  const url = String(WEBHOOK_URL).trim();
  return url === "" || url.includes("ACA VA");
}

// Envía el mensaje a Make con un límite de 30 segundos
async function pedirRespuesta(mensaje) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mensaje, fecha: new Date().toISOString() }),
      signal: controlador.signal
    });
    const texto = await respuesta.text();
    return { ok: respuesta.ok, status: respuesta.status, texto };
  } finally {
    clearTimeout(temporizador);
  }
}

// Saca el texto a mostrar a partir de lo que respondió Make
function extraerRespuesta(textoCrudo) {
  const texto = textoCrudo.trim();
  if (texto === "") return "(respuesta vacía)";

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    return texto; // No es JSON: se muestra tal cual (ej. "Accepted")
  }

  if (datos && typeof datos === "object" && !Array.isArray(datos)) {
    const campos = ["response", "respuesta", "message", "mensaje"];
    for (const campo of campos) {
      const valor = datos[campo];
      if (typeof valor === "string" && valor.trim() !== "") return valor;
    }
    return "Make respondió, pero sin el campo response";
  }
  return texto; // JSON que no es un objeto: se muestra tal cual
}

// Muestra el resultado en el chat
function mostrarResultado(resultado) {
  if (!resultado.ok) {
    agregarBurbuja(
      "Make respondió con error (código " + resultado.status + "). " +
      "Revisá que tu escenario esté en Active o que hayas apretado Run once.",
      "error"
    );
    return;
  }
  agregarBurbuja(extraerRespuesta(resultado.texto), "agente");
}

// Mensaje distinto para tiempo agotado, falla de red u otro problema
function mensajeDeError(error) {
  if (error && error.name === "AbortError") {
    return "La respuesta tardó más de 30 segundos. Probá de nuevo en un momento.";
  }
  if (error instanceof TypeError) {
    return "No se pudo conectar con el servidor. Revisá tu conexión a internet.";
  }
  return "Ocurrió un error inesperado. Probá de nuevo.";
}

// ---------- Envío ----------

async function manejarEnvio(evento) {
  evento.preventDefault();
  if (enviando) return;

  const mensaje = campoMensaje.value.trim();
  if (mensaje === "") return;

  // Validación de longitud
  if (mensaje.length > LIMITE_CARACTERES) {
    agregarBurbuja("El mensaje supera los " + LIMITE_CARACTERES + " caracteres.", "error");
    return;
  }

  agregarBurbuja(mensaje, "usuario");
  campoMensaje.value = "";
  actualizarContador();

  // Si la URL no está configurada, no se hace el fetch
  if (urlSinConfigurar()) {
    agregarBurbuja(AVISO_SIN_URL, "error");
    cambiarEstado("error");
    return;
  }

  enviando = true;
  bloquearControles(true);
  cambiarEstado("cargando");

  try {
    const resultado = await pedirRespuesta(mensaje);
    mostrarResultado(resultado);
    cambiarEstado(resultado.ok ? "exito" : "error");
  } catch (error) {
    agregarBurbuja(mensajeDeError(error), "error");
    cambiarEstado("error");
  } finally {
    // Nunca dejamos la pantalla en "cargando"
    if (zonaDeChat.dataset.estado === "cargando") cambiarEstado("error");
    // Pausa mínima antes de permitir otro envío
    setTimeout(liberarControles, PAUSA_ENTRE_ENVIOS_MS);
  }
}

// ---------- Inicio ----------

zonaDeEscritura.addEventListener("submit", manejarEnvio);
campoMensaje.addEventListener("input", actualizarContador);

// Enter envía; Shift + Enter hace un salto de línea
campoMensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    zonaDeEscritura.requestSubmit();
  }
});

agregarBurbuja(
  "¡Hola! Soy tu agente de viaje. Preguntame por destinos, precios y todo lo que necesites para planear tu viaje.",
  "agente"
);
cambiarEstado("exito");
actualizarContador();
