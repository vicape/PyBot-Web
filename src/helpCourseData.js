export const HELP_COURSE = {
  es: {
    badge: "Curso guiado",
    title: "Python desde cero para mentes curiosas (12-15)",
    subtitle:
      "Una ruta completa, clara y divertida para pasar de \"no se nada\" a crear proyectos reales.",
    modules: [
      {
        id: "m1",
        title: "1) Primeros pasos",
        summary: "Que es programar, como piensa una compu y tu primer programa.",
        lessons: [
          {
            id: "m1l1",
            title: "Tu primer programa",
            duration: "10 min",
            objective: "Entender para que sirve print() y como ejecutar codigo.",
            steps: [
              "Escribi print(\"Hola, mundo\") en el editor.",
              "Presiona Ejecutar y mira la salida en Terminal.",
              "Cambia el texto por tu nombre y vuelve a ejecutar.",
            ],
            challenge: "Mostra 3 mensajes distintos en 3 lineas.",
            tip: "Cada vez que ejecutes, la compu lee linea por linea.",
            code: 'print("Hola, mundo")\nprint("Soy Sofi")\nprint("Me gusta programar")',
          },
          {
            id: "m1l2",
            title: "Variables: cajas con informacion",
            duration: "12 min",
            objective: "Guardar datos y reutilizarlos.",
            steps: [
              "Crea una variable nombre = \"Ana\".",
              "Crea edad = 13.",
              "Imprime un mensaje usando esas variables.",
            ],
            challenge: "Cambia nombre y edad sin tocar el print final.",
            tip: "Las variables te evitan repetir texto y numeros.",
            code: 'nombre = "Ana"\nedad = 13\nprint("Hola, soy", nombre)\nprint("Tengo", edad, "anios")',
          },
        ],
      },
      {
        id: "m2",
        title: "2) Decisiones y logica",
        summary: "Hacer que el programa elija: if, else y comparaciones.",
        lessons: [
          {
            id: "m2l1",
            title: "Si pasa esto... hace esto",
            duration: "15 min",
            objective: "Usar if y else para tomar decisiones.",
            steps: [
              "Define una variable nota.",
              "Usa if para comprobar si aprueba.",
              "Muestra un mensaje diferente si no aprueba.",
            ],
            challenge: "Agrega elif para distinguir excelente / bien / a mejorar.",
            tip: "Despues de if va : y adentro va sangria (espacios).",
            code: 'nota = 8\nif nota >= 7:\n    print("Aprobado")\nelse:\n    print("A seguir practicando")',
          },
          {
            id: "m2l2",
            title: "Comparar y combinar condiciones",
            duration: "15 min",
            objective: "Usar >, <, ==, and, or.",
            steps: [
              "Crea dos variables: edad y tiene_permiso.",
              "Combina condiciones con and.",
              "Prueba cambiando valores para ver resultados.",
            ],
            challenge: "Haz una regla para entrar a un juego segun edad o permiso.",
            tip: "== compara, = asigna. Son distintos.",
            code: "edad = 13\ntiene_permiso = True\nif edad >= 13 and tiene_permiso:\n    print(\"Puede entrar\")\nelse:\n    print(\"No puede entrar\")",
          },
        ],
      },
      {
        id: "m3",
        title: "3) Repeticiones y patrones",
        summary: "Repetir tareas sin copiar y pegar: for y while.",
        lessons: [
          {
            id: "m3l1",
            title: "for: repetir con control",
            duration: "15 min",
            objective: "Recorrer rangos y listas.",
            steps: [
              "Usa for i in range(5).",
              "Imprime i en cada vuelta.",
              "Prueba range(1, 11) para contar del 1 al 10.",
            ],
            challenge: "Muestra la tabla del 7.",
            tip: "range(inicio, fin) no incluye el fin.",
            code: "for i in range(1, 11):\n    print(\"7 x\", i, \"=\", 7 * i)",
          },
          {
            id: "m3l2",
            title: "while: repetir hasta cumplir condicion",
            duration: "15 min",
            objective: "Controlar repeticiones con una condicion.",
            steps: [
              "Crea contador = 0.",
              "Repite mientras contador sea menor a 5.",
              "Incrementa contador en cada vuelta.",
            ],
            challenge: "Haz una cuenta regresiva de 5 a 1.",
            tip: "Si no cambias la condicion, while puede quedar infinito.",
            code: "contador = 0\nwhile contador < 5:\n    print(\"Vuelta\", contador)\n    contador = contador + 1",
          },
        ],
      },
      {
        id: "m4",
        title: "4) Funciones y orden",
        summary: "Crear bloques reutilizables para pensar como pro.",
        lessons: [
          {
            id: "m4l1",
            title: "Funciones con parametros",
            duration: "18 min",
            objective: "Separar tareas y reutilizar codigo.",
            steps: [
              "Define una funcion saludar(nombre).",
              "Haz que devuelva un texto.",
              "Llamala con varios nombres.",
            ],
            challenge: "Crea una funcion para calcular doble(x).",
            tip: "Definir no es ejecutar: hay que llamar la funcion.",
            code: 'def saludar(nombre):\n    return "Hola, " + nombre\n\nprint(saludar("Leo"))\nprint(saludar("Mia"))',
          },
          {
            id: "m4l2",
            title: "Listas para manejar muchos datos",
            duration: "18 min",
            objective: "Guardar y recorrer colecciones.",
            steps: [
              "Crea una lista con 4 nombres.",
              "Recorre la lista con for.",
              "Muestra un mensaje para cada elemento.",
            ],
            challenge: "Imprime el largo de la lista y el primer elemento.",
            tip: "La posicion empieza en 0.",
            code: 'nombres = ["Ana", "Leo", "Mia", "Tomi"]\nfor n in nombres:\n    print("Hola", n)\nprint("Cantidad:", len(nombres))\nprint("Primero:", nombres[0])',
          },
        ],
      },
      {
        id: "m5",
        title: "5) Proyectos increibles",
        summary: "Aplicar todo en retos reales con y sin hardware.",
        lessons: [
          {
            id: "m5l1",
            title: "Proyecto sin hardware: mini quiz",
            duration: "25 min",
            objective: "Combinar variables, if y puntaje.",
            steps: [
              "Define respuesta_correcta y respuesta_usuario.",
              "Compara y suma puntaje si acierta.",
              "Muestra resultado final.",
            ],
            challenge: "Agrega 3 preguntas y cuenta puntos.",
            tip: "Un proyecto pequeno bien terminado vale oro.",
            code: 'puntaje = 0\nrespuesta_usuario = "python"\nif respuesta_usuario == "python":\n    puntaje = puntaje + 1\nprint("Puntaje final:", puntaje)',
          },
          {
            id: "m5l2",
            title: "Proyecto con hardware: semaforo simple",
            duration: "30 min",
            objective: "Controlar salidas y tiempos de forma ordenada.",
            steps: [
              "Enciende pin rojo, espera y apaga.",
              "Repite para amarillo y verde.",
              "Encierra en while True para ciclo continuo.",
            ],
            challenge: "Agrega modo nocturno con parpadeo amarillo.",
            tip: "Primero hacelo funcionar una vez; despues repetilo.",
            code: 'while True:\n    pin("out", 2, 1)\n    wait(1)\n    pin("out", 2, 0)\n\n    pin("out", 3, 1)\n    wait(1)\n    pin("out", 3, 0)\n\n    pin("out", 4, 1)\n    wait(1)\n    pin("out", 4, 0)',
          },
        ],
      },
    ],
  },
  en: {
    badge: "Guided course",
    title: "Python from zero for curious minds (12-15)",
    subtitle:
      "A complete, clear, and fun path from \"I know nothing\" to building real projects.",
    modules: [],
  },
};

