import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { describeError } from "../../../shared/api/client";
import { useLiveSocket } from "../../../shared/realtime/context";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { FieldError, Input, Label } from "../../../shared/ui/input";
import { useUploadSubtitle } from "../hooks/useSession";
import {
  subtitleUploadFormSchema,
  type SubtitleUploadFormInput,
  type SubtitleUploadFormOutput
} from "../schemas/session";

export function SubtitleUploadForm({ mediaId }: { readonly mediaId: string }) {
  const upload = useUploadSubtitle(mediaId);
  const live = useLiveSocket();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<SubtitleUploadFormInput, unknown, SubtitleUploadFormOutput>({
    resolver: zodResolver(subtitleUploadFormSchema),
    defaultValues: { language: "pt-BR" }
  });

  const onSubmit = handleSubmit(async ({ files, language }) => {
    const file = files.item(0);
    if (!file) return;
    const result = await upload.mutateAsync({ fileName: file.name, content: await file.text(), language });
    live.send({ type: "command", command: "setSubtitle", mediaId, subtitleId: result.selectedSubtitleId });
    reset({ language });
  });

  return (
    <form
      aria-label="Enviar legenda"
      className="space-y-3"
      onSubmit={(event) => {
        onSubmit(event).catch(() => undefined);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1">
          <Label htmlFor="subtitle-file">Arquivo de legenda (.srt ou .vtt)</Label>
          <Input
            id="subtitle-file"
            type="file"
            accept=".srt,.vtt"
            className="py-1.5"
            aria-invalid={errors.files ? true : undefined}
            aria-describedby={errors.files ? "subtitle-file-error" : undefined}
            {...register("files")}
          />
          <FieldError id="subtitle-file-error" message={errors.files?.message} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="subtitle-language">Idioma</Label>
          <Input
            id="subtitle-language"
            aria-invalid={errors.language ? true : undefined}
            aria-describedby={errors.language ? "subtitle-language-error" : undefined}
            {...register("language")}
          />
          <FieldError id="subtitle-language-error" message={errors.language?.message} />
        </div>
      </div>
      <Button type="submit" variant="secondary" disabled={upload.isPending}>
        {upload.isPending ? "Enviando…" : "Enviar legenda"}
      </Button>
      {upload.isError ? <Alert tone="error">{describeError(upload.error)}</Alert> : null}
      {upload.isSuccess ? <Alert tone="success">Legenda adicionada e selecionada.</Alert> : null}
    </form>
  );
}
