{
  description = "Standalone Markdown task CLI and development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = lib.genAttrs systems;
      manifest = builtins.fromJSON (builtins.readFile ./package.json);
      vendorArchive = ./. + "/${lib.removePrefix "file:" manifest.dependencies."@callumalpass/mdbase"}";
      source = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./src
          ./docs
          ./package.json
          ./package-lock.json
          ./tsconfig.json
          ./tsup.config.ts
          ./README.md
          ./CHANGELOG.md
          ./LICENSE
          vendorArchive
        ];
      };
      smokeScript = builtins.toFile "mtn-nix-smoke.mjs" ''
        import assert from "node:assert/strict";
        import { spawnSync } from "node:child_process";
        import { mkdtempSync, mkdirSync } from "node:fs";
        import { tmpdir } from "node:os";
        import { join } from "node:path";
        const [cli, version] = process.argv.slice(2);
        const temp = mkdtempSync(join(tmpdir(), "mtn-nix-check-"));
        const collection = join(temp, "collection");
        const home = join(temp, "home");
        mkdirSync(home);
        function run(args, input) {
          const result = spawnSync(cli, args, {
            encoding: "utf8",
            input: input === undefined ? undefined : JSON.stringify(input),
            env: { ...process.env, HOME: home, MDBASE_TASKNOTES_PATH: "" },
          });
          assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
          return result.stdout;
        }
        function agent(operation, ref, input) {
          const result = JSON.parse(run([
            "--path", collection, "agent", operation,
            ...(ref ? [ref] : []),
            ...(input === undefined ? [] : ["--input", "-"]), "--json",
          ], input));
          assert.equal(result.ok, true);
          return result.result;
        }
        assert.equal(run(["--version"]).trim(), version);
        run(["init", collection]);
        assert.equal(JSON.parse(run(["--path", collection, "diagnose", "--json"])).ok, true);
        const request = { title: "tomorrow #literal", path: "tasks/first.md", description: "\nSpecification without a final newline", retryKey: "nix-smoke" };
        const first = agent("create", undefined, request);
        assert.equal(first.frontmatter.title, request.title);
        assert.equal(first.description, request.description);
        assert.equal(agent("create", undefined, request).changed, false);
        agent("create", undefined, { title: "Dependent", path: "tasks/second.md", dependsOn: [first.ref] });
        assert.equal(agent("dependencies", "tasks/second.md").dependencyReady, false);
        agent("note", first.ref, { content: "Nix installed-CLI smoke check", category: "test", adopt: true });
        agent("complete", first.ref);
        assert.equal(agent("dependencies", "tasks/second.md").dependencyReady, true);
        agent("reopen", first.ref);
        assert.equal(agent("dependencies", "tasks/second.md").dependencyReady, false);
        run(["--path", collection, "create", "Capture from Nix #smoke"]);
        assert.equal(JSON.parse(run(["--path", collection, "list", "--json"])).length, 3);
        assert.equal(agent("validate").valid, true);
        console.log("Installed mtn CLI smoke check passed");
      '';
      mkPackage =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "mdbase-tasknotes";
          version = manifest.version;
          src = source;
          nodejs = pkgs.nodejs_22;
          npmDepsHash = "sha256-I48dgyTGmQwGO27Isxc+lkunQdhWoFPPAV5NzUFRWUI=";
          # The fetcher handles registry URLs, not file: tarballs. Keep the pinned
          # integrity and let npm resolve the vendored archive from package.json.
          # Only the build copy is changed; the repository lockfile is untouched.
          postPatch = ''
            ${lib.getExe pkgs.jq} 'del(.packages["node_modules/@callumalpass/mdbase"].resolved)' \
              package-lock.json > package-lock.nix.json
            mv package-lock.nix.json package-lock.json
          '';
          # npm must insert the local, vendored core tarball into its cache.
          makeCacheWritable = true;
          npmInstallFlags = [
            "--no-audit"
            "--no-fund"
          ];
          npmPackFlags = [ "--ignore-scripts" ];
          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            ${lib.getExe pkgs.nodejs_22} ${smokeScript} "$out/bin/mtn" ${lib.escapeShellArg manifest.version}
            runHook postInstallCheck
          '';
          meta = {
            description = manifest.description;
            homepage = "https://github.com/curtbushko/mdbase-tasknotes";
            license = lib.licenses.mit;
            mainProgram = "mtn";
            platforms = systems;
          };
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          package = mkPackage nixpkgs.legacyPackages.${system};
        in
        {
          mtn = package;
          default = package;
        }
      );

      apps = forAllSystems (
        system:
        let
          app = {
            type = "app";
            program = lib.getExe self.packages.${system}.mtn;
            meta.description = manifest.description;
          };
        in
        {
          mtn = app;
          default = app;
        }
      );

      overlays.default = final: _prev: {
        mtn = mkPackage final;
      };

      checks = forAllSystems (system: {
        package = self.packages.${system}.mtn;
      });

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.go-task
              pkgs.bash
            ];
          };
        }
      );
    };
}
