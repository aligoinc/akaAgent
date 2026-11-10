# Các phương án dùng chung engine chiến dịch giữa akaAgent Desktop và Fly

- **Ngày:** 07/10/2026
- **Phiên bản tài liệu:** 1.1 - bổ sung sáu phương án để lựa chọn.
- **Trạng thái:** Đề xuất để thảo luận, chưa chốt phương án và chưa triển khai.
- **Nguồn đối chiếu:** Mã nguồn local của hai repo `akaAgent` và `akaAgentChatApi`.
- **Giới hạn khảo sát:** Chưa audit DB live, chạy thử bản build Node, benchmark hoặc xác nhận đầy đủ khả năng tương thích giữa hai bộ chạy.

## 1. Mục tiêu

Duy trì **một nguồn code nghiệp vụ chiến dịch** có thể đóng gói để chạy ở local và Fly. **Ưu tiên giữ nguồn trong repo akaAgent**, nhưng tài liệu bổ sung cả phương án đổi nơi sở hữu nguồn để so sánh rõ đánh đổi:

| Môi trường | Nơi chạy nghiệp vụ | Nơi thực hiện thao tác Zalo |
|---|---|---|
| akaAgent Desktop | Main process trên máy người dùng | Runtime Zalo local |
| Zalo Server có Chat | Worker trên Fly | Zalo runtime trên Fly |
| Zalo Server không Chat | Cùng bộ chạy trên Fly | Zalo runtime trên Fly |

Kết quả mục tiêu sau khi chuyển đổi hoàn tất (E chỉ đáp ứng một phần):

- Desktop tiếp tục chạy chiến dịch local.
- Tài khoản Zalo Server có Chat và không Chat cùng chạy trên Fly.
- Ngừng sử dụng App Zalo Server trên Windows Server.
- Hợp nhất phần nghiệp vụ chiến dịch vào engine chung theo phương án được chọn; A ưu tiên lấy nguồn từ akaAgent.
- Thêm hoặc sửa nghiệp vụ chiến dịch dùng chung tại một nguồn, sau đó build/phát hành Desktop và build/deploy Fly.

**Một nguồn code không có nghĩa các bản đang chạy tự nhận thay đổi ngay sau khi sửa code.** Desktop cần cập nhật bản cài; Fly cần deploy phiên bản mới. Các thay đổi chỉ nằm trong workflow/block DB có thể có cơ chế cập nhật khác, nhưng vẫn phải kiểm tra tương thích helper, phiên bản runtime và cache.

## 2. So sánh sáu phương án

Các phương án khác nhau ở ba quyết định: **lấy engine nào làm nguồn**, **đặt nguồn code ở đâu**, và **chạy engine trong tiến trình nào**. Có những lựa chọn kết hợp được với nhau; ví dụ package chung của C có thể chạy trong tiến trình riêng như B. Chúng không phải sáu hệ thống bắt buộc loại trừ nhau hoàn toàn.

### 2.1. Bảng lựa chọn nhanh

Đánh giá dưới đây là nhận định kiến trúc từ code local, chưa phải số liệu benchmark hoặc ước lượng công việc đã kiểm chứng. “Mức sửa” tính cả engine, tích hợp, quyền/session; không chỉ phần Docker/build.

| Mã | Phương án | Mức sửa akaAgent | Mức sửa ChatApi | Dùng chung đến đâu? | Đánh đổi chính |
|---|---|---|---|---|---|
| **A** | Build engine từ akaAgent, tích hợp worker Fly hiện có | Vừa đến nhiều ở scheduler/dependency; ít ở UI | Vừa đến nhiều ở adapter và thay bộ chạy | Toàn bộ nghiệp vụ mục tiêu sau khi hợp nhất | Ít xáo trộn repo; engine chung vẫn chịu lịch phát hành và cấu trúc nguồn akaAgent |
| **B** | Một chương trình Node chạy chiến dịch độc lập, dùng ở cả local và Fly | Nhiều ở tách engine, IPC và quản lý tiến trình local | Nhiều ở tích hợp/chuyển quyền sang runner | Toàn bộ nghiệp vụ mục tiêu | Tách tiến trình rõ, thêm công việc vận hành và trao đổi giữa các tiến trình |
| **C** | Tách package engine độc lập, hai ứng dụng cùng import | Nhiều ở tách core và adapter | Nhiều ở thay engine, dữ liệu và adapter | Toàn bộ nghiệp vụ mục tiêu | Ranh giới rõ, phải quản lý một package/đơn vị phát hành chung |
| **D** | Build Linux của App Server Electron, chạy trên Fly với màn hình ảo | Ít hơn ở gỡ Electron; vẫn phải sửa tích hợp | Vừa đến nhiều ở quyền/session và kết nối runtime | Có thể cùng engine akaAgent; phải bỏ executor riêng | Giữ nhiều code cũ, mang cả Electron và các yêu cầu desktop lên server |
| **E** | Hai scheduler nhưng cùng thực thi workflow/block | Vừa, tùy mức logic chuyển vào workflow | Nhiều ở bổ sung workflow engine và helper | Chỉ phần nghiệp vụ trong workflow; lifecycle vẫn có hai nguồn | Chuyển dần được nhưng chưa đạt “mọi logic chỉ sửa một nơi” |
| **F** | Lấy engine ChatApi làm nguồn chung, đưa vào Desktop để chạy local | Nhiều ở thay luồng chiến dịch Zalo và adapter local | Vừa đến nhiều ở tách dependency và hỗ trợ không Chat | Toàn bộ nghiệp vụ Zalo được chuyển | Tận dụng engine Node hiện có; phải xử lý khác biệt với workflow của akaAgent |

**Không phương án nào loại bỏ toàn bộ việc sửa quyền, session và định tuyến cho khách không Chat.** Đây là phần chung của yêu cầu bỏ Windows Server.

### 2.2. Phương án A: lấy akaAgent làm nguồn, chạy trong worker hiện có

**Ý tưởng:** dùng cùng scheduler/workflow của akaAgent. Desktop chạy như hiện tại sau khi tách dependency; Fly import bản build Node vào `system-worker` hiện có.

```text
Nguồn engine trong akaAgent
  +-> Desktop: engine + adapter local
  +-> ChatApi system-worker: cùng engine + adapter Fly
```

**Cần sửa:**

- akaAgent: scheduler, workflow engine, điểm nối dữ liệu, sự kiện, Zalo, media/journal và entry point build Node.
- ChatApi: nơi khởi tạo worker, adapter dữ liệu/lệnh, thay scheduler/executor riêng sau khi đối chiếu đầy đủ.
- Hai bên: thống nhất quyền/session và đường quản lý tài khoản Server không Chat.

**Ưu điểm:** giữ nguồn trong akaAgent như mong muốn; không cần repo mới; có thể tái sử dụng worker, pool và cơ chế quyền điều phối hiện có. Mô hình phát triển chiến dịch qua workflow của akaAgent tiếp tục là nền tảng.

**Hạn chế:** scheduler đang có nhiều phụ thuộc trực tiếp nên việc tách không nhỏ. Lỗi hoặc tải của engine chung vẫn có thể ảnh hưởng các nhiệm vụ cùng tiến trình worker; cần giữ cách ly nhiệm vụ, điều phối và shutdown đang có. Không được kéo nguyên singleton hoặc giả định một user của Desktop vào môi trường nhiều khách.

**Thêm chiến dịch sau này:** chỉnh engine/workflow chung, form/catalog khi cần. ChatApi không thêm executor riêng cho action đó. Nếu thiếu một thao tác Zalo trong protocol Fly thì phải mở rộng adapter/runtime.

**Hợp khi:** ưu tiên giữ akaAgent làm nguồn, giữ hai repo và tận dụng hạ tầng đang chạy.

**Thử nghiệm quyết định:** build Node nạp được engine mà không cần Electron, thực thi một workflow Zalo qua fake adapter, rồi kiểm chứng claim, pause và cleanup với adapter backend. Chưa cần gửi thật hoặc thêm máy Fly để chứng minh ranh giới code.

### 2.3. Phương án B: chương trình chạy chiến dịch Node độc lập

**Ý tưởng:** tạo một chương trình runner Node từ nguồn akaAgent. Trên Desktop, Electron khởi động tiến trình local này và trao đổi qua IPC. Trên Fly, cùng runner chạy trong tiến trình server riêng với cấu hình/adapter phù hợp.

```text
Nguồn runner chung trong akaAgent
  +-> Desktop UI/main -> IPC -> runner local -> Zalo local
  +-> runner trên Fly -> giao thức runtime -> Zalo trên Fly
```

“Một runner” là một chương trình nguồn chung; không mặc định một tiến trình cho mỗi account/staff. Thiết kế số tiến trình và giới hạn đồng thời phải có ngân sách rõ ràng.

**Cần sửa:**

- Bao gồm phần tách Electron và dữ liệu như A.
- Desktop cần giao thức start/stop/pause/log, quản lý tiến trình con, crash, cập nhật phiên bản và cleanup khi app thoát.
- Phải chốt runtime Zalo local nằm trong runner hay tiếp tục ở main process và được gọi qua IPC. Mỗi tài khoản vẫn chỉ có một chủ session.
- Fly cần thay phần chiến dịch trong worker cũ bằng runner hoặc chuyển quyền chạy sang runner; giữ xử lý sự kiện Chat ở nơi phù hợp.
- Nếu runner tách khỏi tiến trình giữ pool hiện tại, phải chọn cách truy cập dữ liệu có giới hạn. Không tạo thêm pool độc lập theo thói quen.

**Ưu điểm:** vòng đời engine rõ và có thể kiểm thử/khởi động riêng; giảm việc lỗi engine làm chết main process Desktop; thay đổi triển khai runner ít phụ thuộc UI.

**Hạn chế:** thêm giao thức giữa các tiến trình, xử lý crash và thứ tự shutdown. Đóng gói runtime Node/native module, quyền file và đường dẫn local phức tạp hơn. Chạy tách tiến trình không loại bỏ công việc bàn giao khóa và phục hồi.

Fly hỗ trợ process group chạy trên Machine riêng; vì vậy thêm một group không chỉ là thêm lệnh khởi động trong cùng máy. Đây là khả năng của nền tảng, chưa phải đề xuất đã được duyệt về số máy hoặc connection. [Tài liệu Fly về process groups](https://docs.fly.io/launch/processes).

**Thêm chiến dịch sau này:** sửa nguồn runner chung, rồi phát hành bản Desktop kèm runner và image Fly. Adapter vẫn cần cập nhật khi có thao tác mới.

**Hợp khi:** muốn tiến trình chạy chiến dịch có thể vận hành/kiểm thử riêng, chấp nhận sửa nhiều hơn lúc đầu và quản lý thêm ranh giới tiến trình.

**Thử nghiệm quyết định:** runner local khởi động/dừng theo Electron, không có tác vụ gửi tiếp sau khi bị hủy, và phục hồi được trạng thái khi runner hoặc UI bị tắt. Phải chứng minh rollback/cập nhật không chạy đồng thời hai runner.

### 2.4. Phương án C: package engine độc lập cho hai ứng dụng

**Ý tưởng:** tách nghiệp vụ thành package có contract rõ, chẳng hạn `@aka-agent/campaign-engine`. Package có thể nằm trong một thư mục/package của akaAgent hoặc một repo riêng; chỉ chuyển repo nếu đội phát triển thực sự cần.

```text
Package engine dùng chung, có phiên bản
  +-> akaAgent Desktop + adapter local
  +-> ChatApi worker + adapter Fly
```

Khác biệt với A là chủ động thiết kế engine thành đơn vị độc lập, không phụ thuộc vào cấu trúc service/repository của ứng dụng gốc. Nếu A được tách ranh giới đầy đủ dần, A có thể tiến tới C mà không cần làm lại từ đầu.

**Cần sửa:**

- Tách type/contract, workflow executor, chính sách và các module nghiệp vụ dùng chung ra khỏi import ứng dụng.
- Cả hai ứng dụng cung cấp adapter dữ liệu, Zalo, sự kiện, đồng hồ và tài nguyên.
- Chuyển bộ test hành vi chung vào package; xây quy trình phát hành và kiểm tra tương thích.
- Package core không tự khởi tạo Supabase client, SQL pool, Electron hoặc Zalo socket.

**Ưu điểm:** ranh giới rõ, dễ kiểm tra hai bên thật sự dùng cùng nghiệp vụ; thuận lợi nếu sau này có thêm một ứng dụng dùng engine. Hai sản phẩm có thể nâng cấp package theo lịch riêng với phiên bản rõ ràng.

**Hạn chế:** mức refactor ban đầu lớn; nếu thiết kế quá tổng quát sẽ tăng việc chuyển kiểu dữ liệu và abstraction mà chưa có lợi ích. Hai bên vẫn phải build/nâng phiên bản package; một repo/package mới không tự làm hành vi hai runtime giống nhau.

**Thêm chiến dịch sau này:** chỉnh engine/package hoặc workflow chung rồi cập nhật dependency ở hai sản phẩm; form và thao tác môi trường mới vẫn có phần sửa tương ứng.

**Hợp khi:** muốn ranh giới lâu dài rõ ràng, có nhiều người cùng phát triển, chấp nhận dành công sức chuẩn hóa engine.

**Thử nghiệm quyết định:** package build và test độc lập, không import ngược service của akaAgent/ChatApi; cùng fixture tạo cùng quyết định nghiệp vụ qua hai adapter.

### 2.5. Phương án D: giữ Electron, build App Server Linux để chạy trên Fly

**Ý tưởng:** tận dụng App Zalo Server Electron hiện có, build cho Linux và đóng gói lên Fly. Dùng môi trường hiển thị ảo thay vì gỡ toàn bộ Electron ngay từ đầu.

```text
Nguồn engine hiện có trong akaAgent
  +-> Desktop trên máy người dùng
  +-> App Server Electron bản Linux trên Fly
         -> adapter tới Zalo runtime Fly
```

**Mức xác thực:** hướng này mới là giả thuyết cần làm thử. Electron có tài liệu chạy trong môi trường không có màn hình bằng Xvfb, nhưng tài liệu đó nói về CI; không chứng minh App Server hiện tại đã phù hợp vận hành production trên Fly. [Tài liệu Electron về headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci).

**Cần sửa:**

- Build Linux và môi trường thư viện hệ thống, hiển thị ảo, native module, user chạy tiến trình, file tạm và shutdown.
- Tách vòng đời “đóng cửa sổ” khỏi vận hành server; chuyển tín hiệu điều khiển/log sang cơ chế phù hợp.
- Hỗ trợ tài khoản có/không Chat, session và dữ liệu như các phương án khác.
- Với tài khoản Chat, nối engine này vào runtime Fly đang sở hữu tài khoản; không khởi tạo thêm socket cùng account. Nếu muốn chuyển cả quyền sở hữu socket sang App Server mới, đó là phạm vi lớn hơn và cần thiết kế riêng.
- Thay/bỏ đường nghiệp vụ riêng trong Chat worker để thật sự chỉ còn một nguồn engine.

**Ưu điểm:** giảm phần việc loại bỏ phụ thuộc Electron ngay lập tức; tận dụng đường chạy Desktop/App Server đang có và giữ nguồn ở akaAgent.

**Hạn chế:** mang dependency và vòng đời ứng dụng desktop lên server; có thể cần nhiều RAM/image hơn bản Node gọn, nhưng chưa có số đo. GUI ẩn không có nghĩa không tạo renderer/cửa sổ. Không giải quyết tự động khác biệt session, quyền, dữ liệu hoặc kết nối Chat. Chưa thể kết luận đây là phương án nhanh nhất khi tính toàn bộ tích hợp.

Không thể deploy file cài Windows lên Fly rồi coi là đã hoàn thành; đây là bản Linux với môi trường và kiểm thử riêng.

**Thêm chiến dịch sau này:** cùng nguồn engine/workflow của akaAgent; build Desktop và image Electron Linux. Khả năng chỉ sửa nghiệp vụ một nơi phụ thuộc việc bỏ executor riêng trong Chat và không tạo nhánh nghiệp vụ Linux riêng.

**Hợp khi:** ưu tiên giữ nhiều code hiện có để đánh giá chuyển đổi ngắn hạn, chấp nhận thử nghiệm và chi phí vận hành Electron. Nên đặt tiêu chí dừng rõ nếu footprint, shutdown hoặc tích hợp trở nên phức tạp.

**Thử nghiệm quyết định:** khởi động và dừng sạch trên image Linux, đo RAM khi nhàn rỗi và khi chạy, chạy workflow bằng fake adapter, kiểm tra native module/file/journal và chứng minh không có socket Zalo trùng. Chưa được coi là sẵn sàng production chỉ vì app đã mở được.

### 2.6. Phương án E: dùng chung workflow/block, giữ hai scheduler

**Ý tưởng:** akaAgent và ChatApi cùng thực thi định nghĩa workflow/block. Hai bên vẫn có scheduler, discovery và lifecycle riêng.

```text
Một bộ workflow/block nghiệp vụ
  +-> scheduler Desktop + workflow engine local
  +-> scheduler Chat + workflow engine trên Fly
```

**Cần sửa:**

- ChatApi bổ sung workflow engine và helper contract tương thích với akaAgent.
- Chuyển luồng hành động đang viết cứng trong executor Chat sang thực thi workflow.
- Rà những quy tắc đang nằm trong scheduler akaAgent: muốn dùng chung thì phải chuyển chúng sang workflow hoặc module chung; dùng cùng workflow không tự gom các quy tắc này.
- Giữ và kiểm chứng hai scheduler cùng các adapter, quyền/session cho Server không Chat.

**Ưu điểm:** phù hợp khi đội ngũ tạo nhiều chiến dịch bằng block/workflow; có thể thay từng nhóm action trong khi chưa hợp nhất toàn bộ lifecycle.

**Hạn chế:** vẫn phải sửa hai nơi khi thay quy tắc còn nằm ở scheduler như nhận việc, lịch, pause, cleanup hoặc phục hồi. Helper trùng tên phải có ngữ nghĩa giống nhau; nếu mỗi bên tự diễn giải thì lại lệch nghiệp vụ. Thay workflow DB vẫn cần kiểm soát tương thích, cache và quyền; không đồng nghĩa thay gì cũng nhận ngay.

**Thêm chiến dịch sau này:** nếu chỉ ghép những block/helper đã có thì có thể định nghĩa một lần. Nếu đụng scheduler hoặc helper mới, vẫn sửa hai phía.

**Hợp khi:** mục tiêu trước mắt là giảm việc viết lại từng action, hoặc cần bước chuyển tiếp có giới hạn.

**Mức đáp ứng:** **một phần**, không đáp ứng đầy đủ yêu cầu một nguồn cho toàn bộ nghiệp vụ/lifecycle. Nếu chọn E làm giai đoạn đầu, phải ghi rõ phần còn hai nguồn và điều kiện chuyển tiếp sang A/C hoặc nguồn chung khác.

**Thử nghiệm quyết định:** chạy cùng workflow ở cả hai bên và so kết quả helper, lỗi, hủy và nhánh điều kiện; liệt kê rõ những quyết định vẫn ở hai scheduler.

### 2.7. Phương án F: lấy engine ChatApi làm nguồn, đưa vào Desktop

**Ý tưởng:** chọn scheduler/executor Node của ChatApi làm nền tảng engine chung, rồi cung cấp adapter local để Desktop chạy ngay trên máy người dùng.

```text
Nguồn engine Node từ ChatApi
  +-> worker Fly + adapter backend/runtime
  +-> akaAgent Desktop + adapter dữ liệu/Zalo local
```

Đây là thay đổi ưu tiên **nguồn nằm ở akaAgent**, nhưng vẫn có thể đạt các yêu cầu bắt buộc: thực thi local trên Desktop và một engine chung cho Local/Server.

**Cần sửa:**

- ChatApi: tách engine khỏi concrete repository, command client, worker-global và các giả định server. Không mang `pg` pool/credential backend vào Desktop; dùng adapter dữ liệu được phép cho Desktop.
- akaAgent: thay đường thực thi chiến dịch Zalo bằng engine này, nối với runtime local, UI và vòng đời app. Giữ Facebook/Email/trình duyệt ở bộ chạy phù hợp.
- Bù những chức năng Desktop có mà Chat executor chưa có, nhất là workflow tùy biến/test workflow, action chỉ có ở Desktop và helper liên quan.
- Hỗ trợ Server không Chat và thống nhất session/quyền như các phương án khác.

**Ưu điểm:** bắt đầu từ bộ chạy Node đang thiết kế cho server; có thể tái sử dụng các cơ chế phục hồi và giao thức server. Không phải gỡ Electron khỏi scheduler lớn để đưa lên Fly.

**Hạn chế:** thay đổi sâu đường chạy Zalo Desktop, có rủi ro mất khả năng workflow hiện có nếu không bổ sung. Lợi thế Node không có nghĩa engine hiện tại độc lập sẵn. Nếu tiếp tục duy trì engine Desktop cũ cho những chiến dịch chưa chuyển thì mục tiêu một nguồn chỉ đạt sau khi hoàn tất độ phủ.

**Thêm chiến dịch sau này:** sửa nguồn engine chung được chọn ở ChatApi hoặc package tách ra; Desktop/Fly cùng cập nhật. Nếu người dùng muốn tiếp tục định nghĩa chiến dịch bằng workflow, phải đưa khả năng đó vào engine chung thay vì bỏ qua.

**Hợp khi:** ưu tiên thiết kế server hiện có và chấp nhận thay luồng chạy Zalo Desktop nhiều hơn; không bắt buộc nguồn chuẩn phải ở repo akaAgent.

**Thử nghiệm quyết định:** chạy engine với local adapter không có dependency DB/backend đặc quyền; đối chiếu một chiến dịch đơn và một workflow tùy biến, rồi kiểm tra logout/pause/cleanup theo vòng đời Desktop.

### 2.8. Các lựa chọn phụ và hướng không đáp ứng yêu cầu

**Repo riêng hay monorepo:** là quyết định quản lý nguồn/build. Gộp repo có thể giúp thay đổi đồng thời và khóa dependency, nhưng không tự loại bỏ hai executor. Có thể áp dụng sau khi chọn A/B/C/F; chưa cần gộp repo để bắt đầu.

**Package, build artifact hay git subtree/submodule:** là cách phân phối nguồn. Mục tiêu là chỉ có một nơi được sửa nghiệp vụ và build có phiên bản tái lập được. Copy thủ công rồi nhắc nhau sửa hai bản không đạt mục tiêu; code sinh tự động cũng cần nguồn chuẩn và kiểm tra không chỉnh tay bản sinh.

**Chỉ chuyển Windows Server lên Fly, giữ executor Chat riêng:** có thể bỏ Windows nhưng vẫn có hai nguồn nghiệp vụ. Đây chỉ giải quyết nơi vận hành, chưa giải quyết yêu cầu code một chỗ.

**Cho Fly quyết định toàn bộ chiến dịch, Desktop chỉ thực thi lệnh:** có thể tập trung điều phối, nhưng Desktop không còn tự chạy logic chiến dịch local. Hướng này không đáp ứng yêu cầu hiện tại và chỉ xét nếu người dùng chủ động thay yêu cầu. Chạy engine local vẫn có thể phụ thuộc DB/AI/network như sản phẩm hiện tại; “local” không đồng nghĩa hoàn toàn offline.

### 2.9. Cách chọn theo ưu tiên

| Nếu ưu tiên là... | Hướng nên xem trước | Điều kiện chấp nhận |
|---|---|---|
| Giữ akaAgent làm nguồn, không tổ chức lại toàn bộ repo | **A** | Chấp nhận tách dependency scheduler và viết adapter backend |
| Cách ly tiến trình chiến dịch, vận hành độc lập | **B** | Chấp nhận IPC, đóng gói runner, shutdown/recovery và đánh giá tài nguyên riêng |
| Ranh giới core rõ, dùng lâu dài cho nhiều sản phẩm | **C** | Chấp nhận refactor lớn hơn và quản lý package/phiên bản |
| Giữ tối đa dependency Electron để thử chuyển nhanh | **D** | Chấp nhận làm thử Linux/Fly trước; không coi là giải pháp production đã xác minh |
| Giảm viết lại action trước, chưa thể gom lifecycle ngay | **E** | Chấp nhận còn hai scheduler và đặt lộ trình xử lý phần còn trùng |
| Tận dụng engine Node server, chấp nhận đổi sâu Desktop Zalo | **F** | Chấp nhận đổi nguồn chuẩn và chứng minh giữ đủ khả năng workflow Desktop |

**Khuyến nghị hiện tại:** A phù hợp nhất với ưu tiên đã nêu: giữ akaAgent, chạy local thật và dùng chung nguồn cho Fly. C phù hợp nếu muốn đầu tư tách core rõ ngay từ đầu. D đáng làm một thử nghiệm giới hạn nếu ưu tiên giảm refactor Electron, nhưng chưa đủ bằng chứng để chọn làm đích production. E là bước chuyển tiếp, không nên mô tả như đã đạt toàn bộ mục tiêu.

Không cần triển khai cả sáu để lựa chọn. Có thể chọn hai hướng phù hợp nhất, rồi làm thử bằng fixture/fake adapter để trả lời các điểm chưa chắc chắn. Chỉ sau khi có kết quả mới chốt phương án, ước lượng công việc và kế hoạch triển khai; tài liệu này không phải chấp thuận thực hiện các thử nghiệm hay thay đổi production.

### 2.10. Kiến trúc tham chiếu chi tiết cho phương án A

**Các mục 3-12 bên dưới đi sâu vào A**, là phương án đã phân tích trong bản 1.0. B/C/D/E/F có phạm vi khác như mô tả phía trên, không mặc định phải làm toàn bộ hạng mục của A.

Giữ cấu trúc hai repo hiện tại. Bổ sung bản build Node của bộ chạy trong akaAgent, rồi tích hợp artifact/package đó vào `system-worker` hiện có của ChatApi.

```text
Repo akaAgent
  Scheduler + workflow engine + nghiệp vụ chiến dịch chung
                      |
          +-----------+------------+
          |                        |
     Build Desktop           Build module Node
          |                        |
  Main process local       Worker hiện có trên Fly
          |                        |
  Adapter Desktop            Adapter Fly
          |                        |
  Zalo local               Giao thức lệnh hiện có
  Repository Desktop               |
  IPC tới giao diện         Zalo runtime trên Fly
                            Repository backend
                            Realtime tới client
```

Artifact/package được sinh từ nguồn akaAgent, có phiên bản cố định. Không sao chép thủ công các file sang ChatApi và không duy trì một fork engine dành riêng cho Fly.

Việc engine nằm trong repo akaAgent không bắt buộc phải tạo một dịch vụ mới. Tích hợp vào worker Fly hiện có giúp tái sử dụng cơ chế kết nối dữ liệu, quản lý quyền điều phối, khởi động và shutdown của backend.

#### Phạm vi ưu tiên của A

Phần giao nhau cần hợp nhất là chiến dịch **Zalo QR/API** ở local và Server. Facebook, Email và các chức năng trình duyệt tiếp tục có bộ thực thi phù hợp trên Desktop. Việc hỗ trợ thêm các kênh này trên Fly là phạm vi khác.

#### Ý nghĩa của “giữ nguyên akaAgent” trong A

Giữ repo, cấu trúc sản phẩm, giao diện và nguồn nghiệp vụ chính. Vẫn phải refactor các điểm phụ thuộc Electron, dữ liệu và runtime để bộ chạy dùng được trong Node.

Đây không phải thay đổi chỉ gồm Dockerfile hoặc cấu hình build. Cũng chưa có cơ sở khẳng định số file, thời gian hoặc chi phí triển khai trước khi hoàn tất đối chiếu hành vi.

## 3. Hiện trạng đã quan sát từ code

### akaAgent

- `src/main/services/campaignScheduler.ts` phục vụ Desktop và App Zalo Server hiện tại.
- `src/server/main/zaloServerRuntimeManager.ts` import trực tiếp `CampaignScheduler` của Desktop. Như vậy hai sản phẩm này đã có nền tảng dùng chung bộ chạy.
- Scheduler đang gắn với `BrowserWindow`, IPC, webview/background browser, dịch vụ Zalo và nhiều repository dữ liệu.
- `WorkflowEngineV2` nhận `page = null`; `BlockExecutor` thực thi JavaScript bằng Node `vm`. Luồng Zalo API có nền tảng chạy không cần trình duyệt, nhưng còn phụ thuộc gián tiếp cần tách.
- Một số phần như chuẩn bị nội dung đã được tách thành module, nhưng vẫn có bản sao ở ChatApi và phải kiểm tra để tránh lệch.

### akaAgentChatApi

- `apps/system-worker/src/main.ts` khởi tạo scheduler, executor và bộ tạo data chiến dịch riêng.
- Worker đã có cơ chế tìm chiến dịch toàn hệ thống, quyền điều phối, phục hồi và shutdown.
- Lệnh chiến dịch đi qua giao thức hiện có tới Zalo runtime; runtime quản lý kết nối Zalo.
- Nhiều đường xác thực/nhận chiến dịch còn phụ thuộc quyền Chat.
- Runtime dùng session mã hóa và liên kết tài khoản riêng; không tự nhận mọi session legacy của App Zalo Server.

### Định tuyến trên Desktop

`src/main/ipc/handlers.ts` hiện chọn `ZaloChatApiClient` khi có Chat và `ZaloServerClient` khi không Chat. Vì vậy muốn bỏ Windows Server thì phải sửa cả đường đăng nhập và quản lý tài khoản, không chỉ thay scheduler.

## 4. Những phần cần sửa trong akaAgent theo A

### 4.1. Scheduler chiến dịch

**File chính:** `src/main/services/campaignScheduler.ts`.

Thay các phụ thuộc môi trường bằng giao diện được truyền vào khi khởi tạo:

| Điểm kết nối | Desktop cung cấp | Fly cung cấp |
|---|---|---|
| Phát trạng thái và log | IPC tới renderer | Realtime/log backend |
| Thao tác Zalo | Runtime local | Adapter gửi lệnh tới runtime Fly |
| Đọc/ghi dữ liệu | Repository Desktop | Repository backend |
| Trình duyệt | Webview/Electron | Không cung cấp cho chiến dịch Zalo QR/API |
| Tài nguyên và vòng đời | Vòng đời ứng dụng Desktop | Vòng đời worker |

Nguồn chung tiếp tục sở hữu:

- Trình tự xử lý từng data và batch.
- Chuẩn bị nội dung, xoay mẫu và cá nhân hóa.
- Điều kiện loại trừ và quyết định xử lý kết quả kiểm tra giới hạn.
- Xử lý kết quả/lỗi, tiếp tục hoặc dừng.
- Quy tắc pause, hoàn tất và cleanup của lượt chạy.

Không chỉ đổi constructor: phải rà các vị trí scheduler import trực tiếp repository hoặc dịch vụ để tránh bỏ sót đường phụ thuộc môi trường.

### 4.2. Workflow engine và helper

**Các file chính:**

- `src/main/v2/runtime/workflowEngine.ts`
- `src/main/v2/runtime/blockExecutor.ts`
- `src/main/v2/runtime/blockHelpers.ts`

Cần tách phụ thuộc Electron và cách tải block/workflow, ghi run/step. Desktop và Fly phải dùng cùng định nghĩa workflow/block và cùng helper contract.

Để đạt mục tiêu thêm chiến dịch một nguồn, ChatApi không tiếp tục viết một chuỗi điều kiện riêng theo từng action nhằm tái hiện workflow của akaAgent.

Chức năng đặc thù trình duyệt như webview, chụp ảnh trang và thao tác DOM vẫn do Desktop cung cấp. Build Node chỉ nạp các thành phần phù hợp với khả năng của môi trường Fly.

### 4.3. Adapter thao tác Zalo

**Dịch vụ hiện tại:** `src/main/services/zaloRuntimeService.ts`.

Định nghĩa giao diện chung cho những thao tác engine cần, chẳng hạn:

- Tìm người dùng theo số điện thoại hoặc UID.
- Đọc thông tin người dùng/nhóm.
- Gửi tin, media, chia sẻ nội dung.
- Kết bạn, gắn tag, đổi tên gợi nhớ.
- Các thao tác phục vụ tạo data và chiến dịch realtime.

Desktop nối giao diện này với runtime local. Fly ánh xạ sang giao thức lệnh backend hiện có.

Adapter phải giữ đầy đủ ngữ cảnh tài khoản, chiến dịch, lượt chạy và tín hiệu hủy. Phải phân biệt lỗi xác định với trường hợp chưa biết đã gửi thành công hay chưa; không tự gửi lại chỉ vì timeout.

**Adapter thực hiện thao tác, không quyết định nghiệp vụ riêng cho từng chiến dịch.**

### 4.4. Adapter dữ liệu và ngữ cảnh người chạy

**Các khu vực chính:**

- `src/main/services/supabase.ts`
- `src/main/data/repositories/`
- `src/main/data/currentUser.ts`

Gom những thao tác dữ liệu engine cần thành giao diện rõ ràng: nhận quyền chạy, lấy data, kiểm tra giới hạn, ghi detail, cập nhật trạng thái, hoàn tất và phục hồi lượt lỗi.

Desktop sử dụng triển khai dữ liệu hiện có. Fly sử dụng repository/backend hiện có. Không đưa thông tin kết nối hoặc credential đặc thù môi trường vào engine nghiệp vụ.

Các yêu cầu cần giữ:

- Đúng phạm vi staff, organization và account trong từng lượt chạy.
- Các thao tác cần khóa/quota nguyên tử tiếp tục do DB bảo đảm.
- Không dựa vào user toàn cục khi nhiều khách hàng chạy đồng thời.
- Cơ chế tìm việc trên Fly tiếp tục có phân trang toàn hệ thống; không tạo một vòng polling mới cho mỗi staff.
- Không tăng số truy vấn vô hạn theo người nhận; rà cache workflow/block, lịch sử run/step và truy vấn phụ.

### 4.5. Sự kiện, media và các tác vụ liên quan

Cần rà các dịch vụ đi cùng đường chạy, đặc biệt:

- `src/main/services/zaloRealtimeGroupCampaignManager.ts`
- `src/main/services/zaloCampaignEngagement.ts`
- Media/file tạm, AI và các hook phát log/trạng thái.

Các phần dùng `BrowserWindow`, IPC hoặc đường dẫn dữ liệu Electron cần điểm nối riêng cho Fly.

Theo dõi tương tác tiếp tục là **best effort**: không chờ config/journal/listener trên luồng gửi, detail, quota hoặc lifecycle; không retry gửi vì mất dấu; lọc RAM trước queue/DB. Giữ giới hạn phục hồi INSERT chưa rõ kết quả 5 phút, không gia hạn do retry/restart.

### 4.6. Bản build Node

Thêm entry point và cấu hình build để xuất engine dùng được trong Node từ cùng nguồn đang dùng trên Desktop.

Cần kiểm tra cả dependency gián tiếp để build Node không yêu cầu khởi tạo Electron hoặc UI. Artifact/package có phiên bản cố định và được ChatApi sử dụng trực tiếp khi build.

Không bắt buộc tạo repo core riêng hoặc di chuyển toàn bộ cây thư mục ứng dụng.

## 5. Những phần cần sửa trong akaAgentChatApi theo A

### 5.1. Khởi tạo engine chung trong worker

**Điểm tích hợp:** `apps/system-worker/src/main.ts`.

Worker nạp engine xây từ akaAgent và cung cấp các adapter Fly. Giữ những nhiệm vụ backend khác như xử lý inbox/sự kiện, quản lý quyền điều phối và shutdown.

Mục tiêu là thay phần thực thi chiến dịch, không ngừng toàn bộ `system-worker`.

### 5.2. Thay thế phần nghiệp vụ đang viết riêng

Các file trọng tâm cần đối chiếu:

- `apps/system-worker/src/zaloCampaignScheduler.ts`
- `apps/system-worker/src/zaloCampaignExecutor.ts`
- `apps/system-worker/src/campaignInputMaterializer.ts`

Phần nghiệp vụ tương ứng được thay bằng engine chung sau khi đạt đủ độ phủ.

Trước khi thay phải lập bảng đối chiếu các hành vi hiện có, nhất là:

- Phục hồi sau restart hoặc mất quyền điều phối.
- Pause và dừng giữa batch.
- Timeout, response thất lạc và kết quả gửi chưa xác định.
- Bảo trì lịch qua ngày, hard stop và giới hạn hành động.
- Cleanup khi claim hoặc ghi kết quả chưa rõ trạng thái.

Những hành vi cần thiết đang chỉ có ở Chat phải được đưa vào engine hoặc adapter đúng trách nhiệm. Chọn akaAgent làm nguồn không có nghĩa bỏ các bản sửa đã có ở Chat.

### 5.3. Adapter lệnh và runtime

**Các khu vực chính:**

- `apps/system-worker/src/campaignCommandClient.ts`
- `packages/runtime-protocol/`
- `apps/zalo-server-runtime/src/accountSupervisor.ts`
- `packages/zalo-zca-adapter/`

Ánh xạ thao tác của engine sang lệnh hiện có; chỉ mở rộng protocol/runtime khi thiếu khả năng cần thiết.

Giữ danh tính lệnh, token, runtime generation, cơ chế hủy và chống xử lý lặp. Zalo runtime hiện có tiếp tục là nơi quản lý kết nối tài khoản trên Fly; không mở thêm một phiên Zalo local từ engine chiến dịch.

### 5.4. Repository/backend adapter

**Khu vực chính:** `packages/database/`.

Triển khai giao diện dữ liệu engine cần bằng cơ chế backend hiện có. Phạm vi gồm cả tải workflow/block và ghi lịch sử chạy nếu những thao tác này chưa có trong đường thực thi Chat.

Mặc định tái sử dụng pool, client và cơ chế giữ quyền điều phối hiện tại. HTTP/RPC cũng tiêu thụ tài nguyên DB; việc chuyển cách gọi không thay thế đánh giá tải.

Nếu thiết kế sau này cần thêm nguồn connection, tăng pool hoặc tăng process/replica làm tăng tổng connection thì phải trình bày ngân sách và thảo luận riêng trước khi triển khai.

### 5.5. Quyền Server độc lập với quyền Chat

Cần rà ít nhất:

- `apps/chat-api/src/desktopAuthRoutes.ts`
- Repository quyền, tài khoản và nhận chiến dịch.
- `packages/database/src/campaignRuntimeRepository.ts`
- `packages/database/src/runtimeAccountRepository.ts`

Tổ chức không Chat nhưng có quyền Zalo Server phải được đăng nhập, cấp session và chạy chiến dịch trên Fly.

Quyền Chat vẫn kiểm tra riêng. Không giải quyết bằng cách bật `is_chat_sync` cho toàn bộ khách hàng hoặc bỏ các guard quyền ở mọi API.

### 5.6. Sự kiện của tài khoản không Chat

Tài khoản không Chat vẫn cần các sự kiện phục vụ trạng thái kết nối, kết quả và nghiệp vụ chiến dịch.

Việc lưu/đồng bộ hội thoại và tính năng Chat chỉ hoạt động theo quyền tương ứng. Phải rà cả metadata, fan-out và xử lý nền, không chỉ ẩn giao diện Chat.

## 6. Định tuyến Desktop và chuyển session

### 6.1. Thống nhất đường kết nối Server

Các file chính ở akaAgent:

- `src/main/ipc/handlers.ts`
- `src/main/ipc/handlers/accountHandlers.ts`
- `src/main/ipc/handlers/accountContactHandlers.ts`
- `src/main/services/zaloChatApiClient.ts`
- `src/main/services/zaloServerClient.ts`

Thay việc chọn backend theo quyền Chat bằng định tuyến phù hợp với tài khoản Local/Server và quyền runtime.

Phải bao phủ QR, kiểm tra session, logout, tag, tải danh bạ, hủy tác vụ và chuyển Local/Server. Tài khoản local tiếp tục chạy trên máy người dùng.

Sau khi hoàn tất chuyển đổi, lỗi mạng tới Fly không được tự kích hoạt lại Windows Server hoặc tạo một chủ chạy khác.

### 6.2. Session legacy và session trên Fly

Windows Server sử dụng cơ chế session legacy, trong khi backend dùng session mã hóa và liên kết runtime.

Cần thiết kế quy trình:

1. Ngừng nhận việc mới ở nơi cũ.
2. Xử lý hoặc ghi nhận các lượt đang chạy/chưa rõ kết quả.
3. Xác nhận quyền sở hữu được bàn giao.
4. Chuyển và xác minh session nếu tương thích; yêu cầu QR lại khi cần.
5. Cho runtime Fly nhận tài khoản và xác nhận trạng thái.

Chưa thể cam kết mọi session cũ đều chuyển thẳng được hoặc mọi tài khoản đều không cần đăng nhập lại.

### 6.3. Phạm vi DB chưa được chốt

Có thể cần migration cho quyền, điều kiện nhận tài khoản, liên kết session hoặc RPC liên quan. Chưa có danh sách SQL chính xác vì chưa audit DB live.

Khi thiết kế migration phải đọc đúng definition/signature đang chạy, lưu checksum và kiểm tra fail-closed; không lấy body lịch sử để ghi đè. Chỉ reload schema khi metadata API thực sự thay đổi hoặc đã xác nhận cache cũ. Không apply lại các migration đã triển khai.

## 7. Quy tắc kiến trúc để sau này chỉ sửa nghiệp vụ một nguồn

| Thuộc nguồn engine chung | Thuộc adapter/hạ tầng |
|---|---|
| Trình tự xử lý data/batch và điều kiện gửi | Thực hiện một thao tác Zalo cụ thể |
| Chuẩn bị nội dung và diễn giải kết quả | Truyền lệnh, vận chuyển media, nhận response |
| Quyết định tiếp tục, pause, dừng, hoàn tất | Truy cập dữ liệu và phát sự kiện |
| Hành vi lifecycle/cleanup chung | Discovery, quyền điều phối tiến trình, shutdown |
| Workflow và helper contract nghiệp vụ | Tài nguyên local hoặc Fly |

Các khác biệt hợp lệ giữa Local/Server phải được mô tả rõ bằng contract hoặc policy. Không để adapter chứa một bản logic chiến dịch thứ hai.

### Khi thêm tính năng mới

| Loại thay đổi | Nguồn cần chỉnh |
|---|---|
| Sửa quy tắc hoặc thêm chiến dịch dùng thao tác đã hỗ trợ | Engine/workflow/block chung; bổ sung form/catalog nếu cần |
| Thêm thao tác Zalo hoàn toàn mới | Contract chung, triển khai local và protocol/runtime Fly nếu chưa hỗ trợ |
| Thay giao diện hoặc tính năng riêng của Chat | Thành phần sản phẩm tương ứng |
| Thay DB hoặc helper contract | Migration/config chung và kiểm tra tương thích các phiên bản |

“Một nguồn” là một nguồn cho nghiệp vụ dùng chung, không phải mọi tính năng chỉ sửa một file hoặc không bao giờ cần thay adapter.

## 8. Lộ trình thực hiện tham chiếu cho A

| Giai đoạn | Kết quả cần có trước khi chuyển bước |
|---|---|
| 1. Chốt contract và đối chiếu hành vi | Danh sách action/workflow/helper, hành vi Desktop/Chat và các khác biệt cần giữ |
| 2. Tách dependency trong akaAgent | Desktop dùng adapter với hành vi được giữ; bản build Node nạp được engine không cần Electron |
| 3. Tích hợp worker Fly | Engine chung dùng adapter backend, giữ discovery/leadership/recovery và kết nối hiện có |
| 4. Hỗ trợ Server không Chat | Quyền runtime, QR/session, tag, danh bạ và sự kiện hoạt động mà không mở rộng quyền Chat |
| 5. Chuyển từng nhóm tài khoản | Bàn giao quyền sở hữu có kiểm soát; giữ tiến độ, quota, vị trí xoay nội dung và xử lý lượt chưa rõ kết quả |
| 6. Ngừng bộ chạy cũ | Hoàn tất kiểm chứng trước khi bỏ Windows Server và phần executor nghiệp vụ riêng của ChatApi |

Không chạy hai engine có quyền gửi thật trên cùng một tài khoản để so sánh. Đối chiếu bằng fixture/mô phỏng trước; mọi kiểm chứng production có tác động thực tế cần nằm trong phạm vi được cho phép.

### Rollback

Rollback không chỉ là đổi image. Phải ngừng nhận việc, xử lý lượt chưa rõ kết quả và bàn giao quyền sở hữu trước khi cho bộ chạy cũ nhận lại tài khoản.

Đường rollback cũng phải giữ tương thích session, dữ liệu và phiên bản workflow/protocol; tránh reset tiến độ hoặc xóa lịch sử cần cho phục hồi.

## 9. Kiểm chứng cần thực hiện

### Nghiệp vụ

- Mỗi action thuộc phạm vi hỗ trợ chạy qua cả adapter local và Fly.
- Nội dung, xoay mẫu, điều kiện loại trừ, quota và trạng thái kết quả nhất quán.
- Batch thành công một phần, pause/resume, lịch qua ngày và hard stop có hành vi đúng.
- Workflow tùy biến và helper thiếu/khác phiên bản được xử lý rõ ràng.

### Phục hồi và chống chạy trùng

- Restart, mất leadership, đổi session và hủy khi đang gửi.
- Response thất lạc, media timeout và INSERT chưa rõ kết quả.
- Không có hai bộ chạy cùng sở hữu tài khoản/campaign.
- Không tự gửi lại người nhận chỉ vì mất dấu engagement hoặc chưa nhận được response.

### Phân quyền

- Server có Chat và không Chat.
- Local có Chat và không Chat trong phạm vi sản phẩm đang hỗ trợ.
- Sai tenant, hết quyền và thu hồi quyền trong lúc chạy.
- Quyền runtime không mở quyền đọc/lưu hội thoại Chat ngoài phạm vi đã thống nhất.

### Build và tài nguyên

- Hai typecheck của akaAgent: main/preload/shared và renderer.
- Build Desktop, build engine Node và kiểm tra dependency Electron không lọt vào đường chạy Fly.
- Test/typecheck/build ChatApi và bộ test hành vi chung cho hai adapter.
- Đo tải discovery, đọc workflow, ghi run/step, queue, media và bộ nhớ.
- Giữ ngân sách connection; không tăng pool hoặc replica để chữa timeout khi chưa xác định nguyên nhân.

## 10. Các quyết định cần chốt trước khi triển khai

Trước hết chọn A/B/C/D/E/F hoặc tổ hợp có ranh giới rõ; xác nhận chấp nhận phần yêu cầu chưa đạt nếu chọn E. Sau đó chốt các nội dung kỹ thuật:

1. Danh sách chiến dịch Zalo, workflow tùy biến và helper thuộc đợt chuyển đầu tiên.
2. Bảng đối chiếu hành vi và các bản sửa hiện có giữa Desktop/Windows Server và Chat worker.
3. Cơ chế đóng gói/phát hành artifact từ akaAgent, khóa phiên bản và phối hợp release.
4. Cách xác thực runtime Server độc lập với quyền Chat.
5. Khả năng chuyển session legacy và các trường hợp phải QR lại.
6. Các RPC/guard/quyền DB thực sự cần thay sau khi đọc live.
7. Cách kiểm soát tương thích engine, workflow và protocol với Desktop cũ.
8. Dữ liệu đo tải để xác nhận khả năng vận hành khi thêm tài khoản không Chat vào Fly.

## 11. Bản đồ mã nguồn tham chiếu

Đường dẫn tính từ gốc repo tương ứng. Đây là các điểm đã đọc để lập đề xuất, chưa phải danh sách cuối cùng sẽ chỉnh sửa.

### Repo akaAgent

| Đường dẫn | Vai trò |
|---|---|
| `src/main/services/campaignScheduler.ts` | Scheduler và nghiệp vụ chiến dịch |
| `src/main/v2/runtime/workflowEngine.ts` | Thực thi workflow |
| `src/main/v2/runtime/blockExecutor.ts` | Thực thi JavaScript của block |
| `src/main/v2/runtime/blockHelpers.ts` | Giao diện helper runtime |
| `src/main/services/zaloRuntimeService.ts` | Thao tác Zalo local |
| `src/main/services/supabase.ts` | Dịch vụ dữ liệu dùng bởi scheduler |
| `src/main/data/currentUser.ts` | Ngữ cảnh người chạy |
| `src/main/services/zaloRealtimeGroupCampaignManager.ts` | Chiến dịch nhóm realtime |
| `src/main/services/zaloCampaignEngagement.ts` | Theo dõi tương tác |
| `src/main/ipc/handlers.ts` | Khởi tạo và chọn remote client |
| `src/main/ipc/handlers/accountHandlers.ts` | Định tuyến thao tác tài khoản |
| `src/main/services/zaloChatApiClient.ts` | Kết nối backend Chat hiện tại |
| `src/server/main/zaloServerRuntimeManager.ts` | App Server tái sử dụng scheduler Desktop |
| `electron.server.vite.config.ts` | Build App Server hiện vẫn là Electron |

### Repo akaAgentChatApi

| Đường dẫn | Vai trò |
|---|---|
| `apps/system-worker/src/main.ts` | Khởi tạo worker và bộ chạy chiến dịch |
| `apps/system-worker/src/zaloCampaignScheduler.ts` | Scheduler Server hiện tại |
| `apps/system-worker/src/zaloCampaignExecutor.ts` | Nghiệp vụ thực thi riêng hiện tại |
| `apps/system-worker/src/campaignInputMaterializer.ts` | Tạo data đầu vào chiến dịch |
| `apps/system-worker/src/campaignCommandClient.ts` | Gửi/nhận lệnh chiến dịch |
| `apps/system-worker/src/campaignWorkerLeadership.ts` | Quyền điều phối và shutdown |
| `packages/database/src/campaignRuntimeRepository.ts` | Dữ liệu, quyền và lifecycle chiến dịch |
| `packages/database/src/runtimeAccountRepository.ts` | Session và cấp tài khoản cho runtime |
| `apps/chat-api/src/desktopAuthRoutes.ts` | Xác thực Desktop vào backend |
| `apps/zalo-server-runtime/src/accountSupervisor.ts` | Thực hiện lệnh theo tài khoản |
| `packages/runtime-protocol/src/index.ts` | Giao thức giữa backend và runtime |

## 12. Tiêu chí chấp nhận phương án

- Có một nguồn nghiệp vụ chiến dịch chung; đặt trong akaAgent đối với A. C/F phải chốt lại nơi sở hữu nguồn. E phải ghi rõ phần chưa đạt mục tiêu.
- Desktop tiếp tục thực thi local; Server có Chat và không Chat cùng chạy trên Fly.
- Không sao chép thủ công code nghiệp vụ giữa hai repo.
- Giữ đúng quyền, tenant, tiến độ, quota và hành vi phục hồi.
- Không chạy trùng hoặc gửi lại không kiểm soát khi chuyển đổi.
- Chỉ ngừng Windows Server và các đường thực thi được thay thế sau khi bộ chạy theo phương án chọn đã được kiểm chứng.
- Phát hành có phiên bản rõ ràng và có đường rollback qua bàn giao quyền sở hữu.

Với A, phạm vi thay đổi lớn nhất là scheduler/workflow và adapter dữ liệu. Với B/C/F, mức thay đổi cách khởi tạo và tích hợp có thể lớn hơn; D chuyển một phần độ phức tạp sang môi trường chạy; E giữ lại chi phí bảo trì hai scheduler. Mọi đánh giá mức sửa, footprint và vận hành trong tài liệu là định tính, chưa có benchmark, giá thành hoặc số ngày đã xác minh. Tài liệu chưa phải cam kết triển khai hay thiết kế SQL cuối cùng.
