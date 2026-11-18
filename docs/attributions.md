# Attributions

FoldRay's own source is MIT, © 2026 Max Stetina; its licence follows this page. Everything below is
other people's work that FoldRay uses or redistributes, and FoldRay's licence does not extend to it.
THIRD-PARTY-NOTICES.txt has the full licence file of every npm package the bundle's modules come
from; Vite's and Rolldown's own helpers ship too and are credited under Build tools below.

---

## Mol\* — MIT

Mol\* (molstar) 5.4.2, <https://molstar.org>. Please cite: Sehnal et al., "Mol\* Viewer: modern web
app for 3D visualization and analysis of large biomolecular structures", *Nucleic Acids Research*
**49**(W1), W431–W437 (2021), doi:10.1093/nar/gkab314.

```
The MIT License

    Copyright (c) 2017 - now, Mol* contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Mol\* is integrated into FoldRay: it draws the interactive preview, and supplies the structure
parsing, secondary structure, bonds, polymer trace, surfaces and selection. Its van der Waals radii
cite Mantina et al., *J. Phys. Chem. A* **113**, 5806–5812 (2009), and its fallback element colours
are Jmol's.

### Code inside Mol\* adapted from others

Under the MIT licence text at the end of this page:

- three.js (© three.js authors), including its port of SMAA (© 2013 Jorge Jimenez, Jose I.
  Echevarria, Belen Masia, Fernando Navarro, Diego Gutierrez) and WestLangley's LineMaterial shader
- gl-matrix (© 2015 Brandon Jones, Colin MacKenzie IV) and quat-from-unit-vec3 (© 2015 Jam3)
- UZIP.js (© 2018 Photopea)
- CIFTools.js (© 2016 David Sehnal) and mmtf-javascript (© 2015-2016 Alexander S. Rose)
- msgpack-js (© 2013 Tim Caswell)
- js-combinatorics (© 2013-2016 Dan Kogai)
- MolQL (© 2017 MolQL contributors)
- NGL (© 2014-2017 Alexander S Rose), whose surface field generation Fred Ludlow adapted from
  AstexViewer (Mike Hartshorn)
- netcdfjs (© 2016 cheminfo) and iobuffer (© 2015 Michaël Zasso)
- jsfeat (© 2012 Eugene Zatepyakin)
- Parsimmon (© 2011-present J. Adkisson)
- ts-fibonacci-heap (© 2014 Daniel Imms)
- setImmediate (© 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola)
- fast-deep-equal (© 2017 Evgeny Poberezkin)
- FileSaver.js (© 2016 Eli Grey)
- webgl2examples (© 2017 Tarek Sherif, Shuai Shao)
- a cylinder impostor (© 2016 Inigo Quilez)
- Rendu's FXAA (© 2017 Simon Rodriguez)
- glsl-float-to-rgba (© 2020 Equinor)
- sphere bounds by Michael Mara and Morgan McGuire, as specialised by Arseny Kapoulkine (© 2018)
- Hash without Sine (© 2014 David Hoskins)
- realism-effects (© 2023 0beqz)
- demofox.org's path-tracing shaders (© 2019 Alan Wolfe)
- AMD FidelityFX Super Resolution sharpening (© 2021 Advanced Micro Devices, Inc.)

Under the BSD licence texts at the end of this page: chroma.js, fastapprox, glsl-rgba-to-float,
glslSmartDeNoise, xdrfile (by way of NGL's XTC reader), and `normalizeWheel` from Facebook's
FixedDataTable. Mol\*'s copy of `normalizeWheel` came by way of a Stack Overflow answer by George,
<https://stackoverflow.com/a/30134826>, licensed CC BY-SA 3.0
(<https://creativecommons.org/licenses/by-sa/3.0/>). Other short snippets in Mol\* are adapted from
Stack Overflow answers: by user128511 (<https://stackoverflow.com/a/28949220>), CC BY-SA 3.0; by Rui
Marques (<https://stackoverflow.com/a/27232658>), Bob Arlof
(<https://stackoverflow.com/a/62094756>) and root-aj (<https://stackoverflow.com/a/6969486>),
CC BY-SA 4.0 (<https://creativecommons.org/licenses/by-sa/4.0/>); and by Michael Zaporozhets
(<https://stackoverflow.com/a/11381730>, with a public-domain regex from detectmobilebrowsers.com),
CC BY-SA 4.0.

Under the ISC licence text at the end of this page: distinct-colors (© 2015 InternalFX Inc.).

Under the Apache License 2.0 at the end of this page: LiteMol (© 2016 David Sehnal) and
DensityServer (© 2016 - now David Sehnal).

Also credited in Mol\*'s source: ColorBrewer (below), Matplotlib's and D3's colour schemes, Paul
Bourke's marching-cubes tables, Bob Jenkins' integer hash (public domain), shader techniques from
bgolus and panoskarabelas.com, and CCP4's `symop.lib`.

---

## Libraries bundled with Mol\*

| Package | Licence | Copyright |
| --- | --- | --- |
| rxjs 7.8.2 | Apache-2.0 (text below) | Copyright (c) 2015-2018 Google, Inc., Netflix, Inc., Microsoft Corp. and contributors |
| immutable 5.1.9 | MIT | Copyright (c) 2014-present, Lee Byron and other contributors. |
| mutative 1.3.0 | MIT | Copyright (c) 2022 Michael Lin |
| tslib 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. |

---

## ColorBrewer

Mol\*'s colour lists include the ColorBrewer schemes.

This product includes color specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/).

```
Apache-Style Software License for ColorBrewer software and ColorBrewer Color
Schemes

Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State
University.

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions as source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. The end-user documentation included with the redistribution, if any, must
include the following acknowledgment: "This product includes color
specifications and designs developed by Cynthia Brewer
(http://colorbrewer.org/)." Alternately, this acknowledgment may appear in the
software itself, if and wherever such third-party acknowledgments normally
appear.

4. The name "ColorBrewer" must not be used to endorse or promote products
derived from this software without prior written permission. For written
permission, please contact Cynthia Brewer at cbrewer@psu.edu.

5. Products derived from this software may not be called "ColorBrewer", nor
may "ColorBrewer" appear in their name, without prior written permission of
Cynthia Brewer.
```

---

## Blender and Cycles

FoldRay's reflection grid follows the checker texture of Cycles, Blender's renderer
(<https://www.blender.org>): Copyright 2011-2022 Blender Foundation, Apache License 2.0.

---

## Environment maps — CC0

The environment maps are CC0 (<https://polyhaven.com/license>).

| Files | Source | Author |
| --- | --- | --- |
| `autumn_meadow.hdr.gz` | [Autumn Meadow](https://polyhaven.com/a/autumn_meadow), Poly Haven | Sergej Majboroda |
| `studio_small_08.hdr.gz` | [Studio Small 08](https://polyhaven.com/a/studio_small_08), Poly Haven | Sergej Majboroda |
| `kloofendal_overcast_puresky.hdr.gz` | [Kloofendal Overcast (Pure Sky)](https://polyhaven.com/a/kloofendal_overcast_puresky), Poly Haven | Greg Zaal |
| `drakensberg_solitary_mountain_puresky.hdr.gz` | [Drakensberg Solitary Mountain (Pure Sky)](https://polyhaven.com/a/drakensberg_solitary_mountain_puresky), Poly Haven | Dimitrios Savva (photography), Jarod Guest (processing) |
| `blue_lagoon_night.hdr.gz` | [Blue Lagoon Night](https://polyhaven.com/a/blue_lagoon_night), Poly Haven | Greg Zaal |
| `studio_small_01.hdr.gz` | [Studio Small 01](https://polyhaven.com/a/studio_small_01), Poly Haven, as Blender bundles it | Greg Zaal |

---

## Filmic view transform — Troy Sobotka

`filmic_desat33.bin.gz` (gzipped) and `filmic_vhc.bin` are Blender's Filmic lookup tables, the work of Troy James
Sobotka (<https://github.com/sobotka/filmic-blender>); the 33³ table is Blender's 2023 subsampling of his 65³.
No licence has been granted for these tables. Sobotka has not licensed them, and has said of their
use elsewhere: "It’s up to you."
(<https://github.com/sobotka/filmic-blender/pull/29#issuecomment-502137400>).

Blender 4.5's `config.ocio` credits the transform in a comment, reproduced verbatim:

```
# OpenColorIO configuration file for Blender
#
# ACEScg and ACES2065-1 spaces using OpenColorIO's BuiltinTransform
#
# Filmic Dynamic Range LUT configuration crafted by Troy James Sobotka with
# special thanks and feedback from Guillermo, Claudio Rocha, Bassam Kurdali,
# Eugenio Pignataro, Henri Hebeisen, Jason Clarke, Haarm-Peter Duiker, Thomas
# Mansencal, and Timothy Lottes.
#
# Based on original AgX by Troy Sobotka: https://github.com/sobotka/AgX https://github.com/sobotka/SB2383-Configuration-Generation
# Further Developed by Zijun Eary Zhou法纤净, Mark Faderbauer, and Sakari Kapanen
# Repository for this version: https://github.com/EaryChow/AgX
#
# See ocio-license.txt for details.
```

The `ocio-license.txt` it names is OpenColorIO's BSD licence for the configuration file, not a
licence for the Filmic tables. Neither FoldRay nor current Blender ships it.

---

## AgX view transform

FoldRay's AgX is Troy Sobotka's design (<https://github.com/sobotka/AgX>), with the matrices of
Blender's AgX configuration by Zijun Eary Zhou (<https://github.com/EaryChow/AgX>,
<https://github.com/EaryChow/AgX_LUT_Gen>). Its code follows
three.js's `AgXToneMapping`, MIT, "Copyright © 2010-2026 three.js authors", which is based on
Filament's, Apache-2.0, "Copyright (C) 2021 The Android Open Source Project". Its sigmoid is Benjamin
Wrensch's fit (<https://iolite-engine.com/blog_posts/minimal_agx_implementation>), MIT,
"Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch)".

FoldRay's path tracer uses Brian Karis's environment-BRDF fit (Epic Games, 2014), as three.js
shipped it (MIT).

---

## Colour

- **Oklab**: Björn Ottosson, <https://bottosson.github.io/posts/oklab/>, public domain (or MIT).
- **The `AlphaFold` pLDDT ramp** is built on AlphaFold DB's four confidence colours (EMBL-EBI and
  Google DeepMind).
- **The `Cividis` ramp**: four stops sampled from Matplotlib's `cividis` table, after Nuñez, Anderton
  & Renslow, *PLOS ONE* **13**(7), e0199239 (2018), doi:10.1371/journal.pone.0199239.

---

## Structures pictured in FoldRay

The gallery tiles, the line-up of thirteen renders on the opening screen, and the README's examples
are FoldRay's own renders.

**PDB entries** (CC0 1.0): 10EC, 1AON, 1AYM, 1BNA, 1CLL, 1L2Y, 1N8Z, 1UBQ, 2GNS, 2YPI, 3ECA, 3INS,
3RGK, 4BP7, 4HHB, 4HKR, 4R8P, 7CGO, 7LCK, 8PWW, 9CCE, 9HAF, 9UGA. Credit belongs to each entry's
authors (see `https://www.rcsb.org/structure/<ID>`; each entry's DOI is 10.2210/pdb<ID>/pdb) and to
the RCSB PDB: Berman et al., *Nucleic Acids Research* **28**, 235–242 (2000).

**AlphaFold DB predictions**: `AF-P69905-F1`, `AF-P05067-F1` and `AF-P42212-F1`, model version 6
(<https://alphafold.ebi.ac.uk/entry/P69905>, <https://alphafold.ebi.ac.uk/entry/P05067>,
<https://alphafold.ebi.ac.uk/entry/P42212>), from the AlphaFold Protein Structure Database by Google
DeepMind and EMBL-EBI. AlphaFold Data Copyright (2021) DeepMind Technologies Limited, licensed under
CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>) and provided as is under AlphaFold DB's
disclaimer (<https://alphafold.ebi.ac.uk/assets/License-Disclaimer.pdf>). Changes: the gallery tiles
and the opening screen's line-up showing these predictions are images FoldRay rendered with its own
representation, camera, lighting, materials and colour. Please cite: Jumper et al., *Nature*
**596**, 583–589 (2021), doi:10.1038/s41586-021-03819-2; Bertoni et al., *Nucleic Acids Research*
**54**(D1), D358–D362 (2026), doi:10.1093/nar/gkaf1226.

**B_des_17**, pictured in the ion Style tiles, is a prototype protein design by Karel Půbal.

---

## Logo

The FoldRay logo is by Amélie Eberhardová and Max Stetina.

---

## Build tools

Vite ("Copyright (c) 2019-present, VoidZero Inc. and Vite contributors") and Rolldown ("Copyright (c)
2024-present VoidZero Inc. & Contributors"), both MIT, build the site; a small part of their
module-loading code ships in the bundle, and Rolldown's part derives from esbuild (MIT, "Copyright
(c) 2020 Evan Wallace").

---

## Licence texts

### MIT License — immutable, mutative, three.js, Benjamin Wrensch, Vite, Rolldown, esbuild and the MIT works inside Mol\*

Each work's own copyright notice is listed with it above.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0 — rxjs, LiteMol, DensityServer, ColorBrewer, Filament and Cycles

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### BSD 3-Clause — chroma.js

```
Copyright (c) 2011-2018, Gregor Aisch
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. The name Gregor Aisch may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL GREGOR AISCH OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause — fastapprox

```
Copyright (c) 2011, Paul Mineiro
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

  * Redistributions of source code must retain the above copyright notice,
    this list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.
  * Neither the name of Paul Mineiro nor the names of its contributors
    may be used to endorse or promote products derived from this software
    without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause — glsl-rgba-to-float

```
BSD 3-Clause License

Copyright (c) 2019, Institute for Health Metrics and Evaluation All rights reserved.
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 - Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 3-Clause — FixedDataTable (`normalizeWheel`)

```
BSD License

For FixedDataTable software

Copyright (c) 2015, Facebook, Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

 * Neither the name Facebook nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific
   prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 2-Clause — glslSmartDeNoise

```
BSD 2-Clause License

Copyright (c) 2019-2020 Michele Morrone
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD 2-Clause — xdrfile

```
Copyright (c) 2009-2014, Erik Lindahl & David van der Spoel
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC licence — distinct-colors

```
Copyright (c) 2015, InternalFX Inc.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
