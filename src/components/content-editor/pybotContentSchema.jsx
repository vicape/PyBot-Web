import {
  BlockNoteSchema,
  createVideoBlockConfig,
  defaultBlockSpecs,
  videoParse,
} from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { es } from "@blocknote/core/locales";
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  ResizableFileBlockWrapper,
  useResolveUrl,
  VideoToExternalHTML,
} from "@blocknote/react";
import { getSafeVideoEmbed } from "./contentMedia.js";
import PybotExerciseBlock from "./PybotExerciseBlock.jsx";
import PybotTaskBlock from "./PybotTaskBlock.jsx";

const SLASH_KEYS = new Set([
  "paragraph",
  "heading",
  "heading_2",
  "heading_3",
  "bullet_list",
  "numbered_list",
  "quote",
  "divider",
  "image",
  "video",
  "audio",
  "file",
  "table",
  "code_block",
]);

const GROUP_RANK = {
  Básico: 0,
  Multimedia: 1,
  Programación: 2,
  PyBotClass: 3,
};

function MenuIcon({ children }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

function ExerciseIcon() {
  return (
    <MenuIcon>
      <path d="M5 4.75h14A1.25 1.25 0 0 1 20.25 6v12A1.25 1.25 0 0 1 19 19.25H5A1.25 1.25 0 0 1 3.75 18V6A1.25 1.25 0 0 1 5 4.75Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9h8M8 12.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </MenuIcon>
  );
}

function TaskIcon() {
  return (
    <MenuIcon>
      <path d="M8.5 4.75h7A1.75 1.75 0 0 1 17.25 6.5v12.75L12 16.5l-5.25 2.75V6.5A1.75 1.75 0 0 1 8.5 4.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </MenuIcon>
  );
}

function VideoButtonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 6.75A1.75 1.75 0 0 1 5.75 5h8.5A1.75 1.75 0 0 1 16 6.75v10.5A1.75 1.75 0 0 1 14.25 19h-8.5A1.75 1.75 0 0 1 4 17.25V6.75Zm13.2 2.1 3.05-1.76A1 1 0 0 1 22 7.93v8.14a1 1 0 0 1-1.75.84L17.2 15.15V8.85Z" />
    </svg>
  );
}

function SafeVideoPreview(props) {
  const raw = props.block.props.url || "";
  const resolved = useResolveUrl(raw);
  const playable = resolved.loadingState === "loaded" ? resolved.downloadUrl : "";
  const embed = getSafeVideoEmbed(raw) || getSafeVideoEmbed(playable);

  if (resolved.loadingState === "loading") {
    return (
      <div className="pbc-media-loading" aria-busy="true">
        Cargando video…
      </div>
    );
  }

  if (embed) {
    return (
      <div className="pbc-safe-video">
        <iframe
          className="bn-visual-media pbc-safe-video__frame"
          src={embed.src}
          title={embed.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation"
        />
      </div>
    );
  }

  if (!playable || playable === "about:blank") {
    return <p className="pbc-media-missing">No se pudo cargar el video.</p>;
  }

  return (
    <video
      className="bn-visual-media"
      src={playable}
      controls
      width={props.block.props.previewWidth || undefined}
      contentEditable={false}
      draggable={false}
    />
  );
}

const createPybotVideo = createReactBlockSpec(createVideoBlockConfig, (config) => ({
  meta: {
    fileBlockAccept: ["video/mp4", "video/webm"],
  },
  render: (props) => (
    <ResizableFileBlockWrapper {...props} buttonIcon={<VideoButtonIcon />}>
      <SafeVideoPreview {...props} />
    </ResizableFileBlockWrapper>
  ),
  parse: videoParse(config),
  toExternalHTML: VideoToExternalHTML,
  runsBefore: ["file"],
}));

export const createPybotExercise = createReactBlockSpec(
  {
    type: "pybotExercise",
    content: "none",
    propSchema: {
      title: { default: "Ejercicio" },
      instructions: { default: "" },
      starterCode: { default: "" },
    },
  },
  {
    render: (props) => <PybotExerciseBlock block={props.block} editor={props.editor} />,
  },
);

export const createPybotTask = createReactBlockSpec(
  {
    type: "pybotTask",
    content: "none",
    propSchema: {
      title: { default: "Tarea" },
      instructions: { default: "" },
      starterCode: { default: "" },
    },
  },
  {
    render: (props) => <PybotTaskBlock block={props.block} editor={props.editor} />,
  },
);

export const pybotContentSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    video: createPybotVideo(),
    pybotExercise: createPybotExercise(),
    pybotTask: createPybotTask(),
  },
});

export const pybotDictionary = {
  ...es,
  placeholders: {
    ...es.placeholders,
    default: "Escribí o pulsá '/' para insertar contenido",
    heading: "Título",
  },
  slash_menu: {
    ...es.slash_menu,
    paragraph: {
      ...es.slash_menu.paragraph,
      title: "Texto",
      subtext: "Texto normal",
      aliases: [...es.slash_menu.paragraph.aliases, "texto", "normal", "párrafo", "parrafo"],
      group: "Básico",
    },
    heading: {
      ...es.slash_menu.heading,
      title: "Título 1",
      subtext: "Título principal",
      aliases: [...es.slash_menu.heading.aliases, "titulo", "título", "titulo 1"],
      group: "Básico",
    },
    heading_2: {
      ...es.slash_menu.heading_2,
      title: "Título 2",
      subtext: "Subtítulo de sección",
      aliases: [...es.slash_menu.heading_2.aliases, "titulo 2", "título 2"],
      group: "Básico",
    },
    heading_3: {
      ...es.slash_menu.heading_3,
      title: "Título 3",
      subtext: "Subtítulo menor",
      aliases: [...es.slash_menu.heading_3.aliases, "titulo 3", "título 3"],
      group: "Básico",
    },
    bullet_list: {
      ...es.slash_menu.bullet_list,
      title: "Lista",
      aliases: [...es.slash_menu.bullet_list.aliases, "viñetas", "vinetas"],
      group: "Básico",
    },
    numbered_list: {
      ...es.slash_menu.numbered_list,
      title: "Lista numerada",
      aliases: [...es.slash_menu.numbered_list.aliases, "numerada", "ol"],
      group: "Básico",
    },
    quote: {
      ...es.slash_menu.quote,
      group: "Básico",
    },
    divider: {
      ...es.slash_menu.divider,
      title: "Separador",
      aliases: [...es.slash_menu.divider.aliases, "separador", "linea"],
      group: "Básico",
    },
    image: {
      ...es.slash_menu.image,
      aliases: [...es.slash_menu.image.aliases, "picture", "fotografía"],
      group: "Multimedia",
    },
    video: {
      ...es.slash_menu.video,
      title: "Video",
      aliases: [...es.slash_menu.video.aliases, "youtube", "vimeo"],
      group: "Multimedia",
    },
    audio: {
      ...es.slash_menu.audio,
      group: "Multimedia",
    },
    file: {
      ...es.slash_menu.file,
      title: "Archivo",
      aliases: [...es.slash_menu.file.aliases, "pdf", "documento"],
      group: "Multimedia",
    },
    table: {
      ...es.slash_menu.table,
      group: "Multimedia",
    },
    code_block: {
      ...es.slash_menu.code_block,
      title: "Código",
      aliases: [...es.slash_menu.code_block.aliases, "código", "python", "programacion"],
      group: "Programación",
    },
  },
  file_panel: {
    ...es.file_panel,
    upload: {
      ...es.file_panel.upload,
      title: "Subir",
      file_placeholder: {
        ...es.file_panel.upload.file_placeholder,
        video: "Subir video",
      },
      upload_error: "No se pudo subir el archivo",
    },
    embed: {
      ...es.file_panel.embed,
      title: "Desde una URL",
      embed_button: {
        ...es.file_panel.embed.embed_button,
        image: "Agregar imagen",
        video: "Agregar video",
        audio: "Agregar audio",
        file: "Agregar archivo",
      },
      url_placeholder: "Pegá o escribí la URL",
    },
  },
};

export function getPybotSlashMenuItems(editor) {
  const defaults = getDefaultReactSlashMenuItems(editor).filter((item) => SLASH_KEYS.has(item.key));

  const custom = [
    {
      title: "Ejercicio",
      subtext: "Crea una práctica para tus alumnos",
      aliases: ["ejercicio", "práctica", "practica", "practice"],
      group: "PyBotClass",
      icon: <ExerciseIcon />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "pybotExercise",
          props: {
            title: "Ejercicio",
            instructions: "",
            starterCode: "",
          },
        });
      },
    },
    {
      title: "Tarea",
      subtext: "Crea una tarea o proyecto",
      aliases: ["tarea", "deberes", "actividad", "proyecto"],
      group: "PyBotClass",
      icon: <TaskIcon />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "pybotTask",
          props: {
            title: "Tarea",
            instructions: "",
            starterCode: "",
          },
        });
      },
    },
  ];

  return [...defaults, ...custom].sort(
    (a, b) => (GROUP_RANK[a.group] ?? 9) - (GROUP_RANK[b.group] ?? 9),
  );
}
