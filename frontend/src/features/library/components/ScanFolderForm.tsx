import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { describeError } from "../../../shared/api/client";
import { Alert } from "../../../shared/ui/alert";
import { Button } from "../../../shared/ui/button";
import { FieldError, Input, Label } from "../../../shared/ui/input";
import { useScanLibrary } from "../hooks/useLibrary";
import { scanFormSchema, type ScanFormInput, type ScanFormOutput } from "../schemas/media";

export interface ScanFolderFormProps {
  readonly quickPaths: readonly string[];
}

export function ScanFolderForm({ quickPaths }: ScanFolderFormProps) {
  const scan = useScanLibrary();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<ScanFormInput, unknown, ScanFormOutput>({
    resolver: zodResolver(scanFormSchema),
    defaultValues: { paths: "" }
  });

  const onSubmit = handleSubmit((values) => {
    scan.mutate(values.paths);
  });

  function scanQuickPath(path: string) {
    setValue("paths", path);
    scan.mutate([path]);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-3" aria-label="Escanear pasta">
      <div className="space-y-1">
        <Label htmlFor="scan-path">Pasta ou arquivo de vídeo</Label>
        <div className="flex gap-2">
          <Input
            id="scan-path"
            placeholder={"C:\\Users\\voce\\Downloads"}
            autoComplete="off"
            aria-invalid={errors.paths ? true : undefined}
            aria-describedby={errors.paths ? "scan-path-error" : "scan-path-hint"}
            {...register("paths")}
          />
          <Button type="submit" disabled={scan.isPending}>
            {scan.isPending ? "Escaneando…" : "Escanear"}
          </Button>
        </div>
        <p id="scan-path-hint" className="text-xs text-muted">
          Separe vários caminhos com ponto e vírgula.
        </p>
        <FieldError id="scan-path-error" message={errors.paths?.message} />
      </div>

      {quickPaths.length > 0 ? (
        <ul aria-label="Pastas sugeridas" className="flex flex-wrap gap-2">
          {quickPaths.map((path) => (
            <li key={path}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  scanQuickPath(path);
                }}
                disabled={scan.isPending}
                title={path}
              >
                {path}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {scan.isError ? <Alert tone="error">{describeError(scan.error)}</Alert> : null}
      {scan.isSuccess ? (
        <Alert tone="success">
          {scan.data.scannedCount === 1 ? "1 vídeo encontrado." : `${scan.data.scannedCount} vídeos encontrados.`}
        </Alert>
      ) : null}
    </form>
  );
}
